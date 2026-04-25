/**
 * db.js — 경락가 SQLite DB
 * 테이블: auction_records (일별 경락 원본), daily_summary (품목별 일별 요약)
 */

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'auction.db');

// data 폴더 생성
const fs = require('fs');
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);

// WAL 모드 (성능 향상)
db.pragma('journal_mode = WAL');

// ── 테이블 생성 ────────────────────────────────────────────────────────
db.exec(`
  -- 원본 경락 데이터
  CREATE TABLE IF NOT EXISTS auction_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_date   TEXT NOT NULL,        -- YYYY-MM-DD
    sale_time   TEXT,                 -- HHMMSS
    item_name   TEXT NOT NULL,        -- 품목명 (예: 딸기)
    kind_name   TEXT,                 -- 품종명 (예: 산딸기)
    unit        TEXT,                 -- 규격 (예: 1kg 상자)
    unit_qty    REAL,                 -- 단위 물량 (예: 1.0)
    origin      TEXT,                 -- 산지
    quantity    REAL,                 -- 수량
    price       REAL,                 -- 낙찰가
    company     TEXT,                 -- 법인명
    market      TEXT,                 -- 도매시장명
    collected_at TEXT DEFAULT (datetime('now')),
    UNIQUE(sale_date, sale_time, item_name, kind_name, unit_qty, quantity, price)
  );

  -- 품목별 일별 요약 (가중평균 등)
  CREATE TABLE IF NOT EXISTS daily_summary (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_date    TEXT NOT NULL,
    item_name    TEXT NOT NULL,
    kind_name    TEXT DEFAULT '',
    unit_qty     REAL DEFAULT 0,
    unit         TEXT DEFAULT '',
    trade_count  INTEGER,             -- 거래 건수
    total_qty    REAL,                -- 총 수량
    min_price    REAL,                -- 최저가
    max_price    REAL,                -- 최고가
    avg_price    REAL,                -- 단순 평균가
    wavg_price   REAL,                -- 수량 가중 평균가 ★
    collected_at TEXT DEFAULT (datetime('now')),
    UNIQUE(sale_date, item_name, kind_name, unit_qty)
  );

  -- 인덱스
  CREATE INDEX IF NOT EXISTS idx_ar_date      ON auction_records(sale_date);
  CREATE INDEX IF NOT EXISTS idx_ar_item      ON auction_records(sale_date, item_name, kind_name);
  CREATE INDEX IF NOT EXISTS idx_ds_date_item ON daily_summary(sale_date, item_name, kind_name);
`);

// ── 경락 원본 저장 ─────────────────────────────────────────────────────
const insertRecord = db.prepare(`
  INSERT OR IGNORE INTO auction_records
    (sale_date, sale_time, item_name, kind_name, unit, unit_qty, origin, quantity, price, company, market)
  VALUES
    (@sale_date, @sale_time, @item_name, @kind_name, @unit, @unit_qty, @origin, @quantity, @price, @company, @market)
`);

function saveRecords(items) {
  const insert = db.transaction((rows) => {
    let cnt = 0;
    for (const r of rows) {
      const info = insertRecord.run({
        sale_date: r.saleDate || '',
        sale_time: r.saleTime || '',
        item_name: r.productName || '',
        kind_name: r.kindName || '',
        unit:      r.unit || '',
        unit_qty:  parseFloat(r.weight) || 0,
        origin:    r.origin || '',
        quantity:  parseFloat(r.quantity) || 0,
        price:     parseFloat(r.price) || 0,
        company:   r.company || '',
        market:    r.market || '',
      });
      if (info.changes > 0) cnt++;
    }
    return cnt;
  });
  return insert(items);
}

// ── 일별 요약 집계 저장 ────────────────────────────────────────────────
const upsertSummary = db.prepare(`
  INSERT OR REPLACE INTO daily_summary
    (sale_date, item_name, kind_name, unit_qty, unit, trade_count, total_qty, min_price, max_price, avg_price, wavg_price)
  VALUES
    (@sale_date, @item_name, @kind_name, @unit_qty, @unit, @trade_count, @total_qty, @min_price, @max_price, @avg_price, @wavg_price)
`);

function buildAndSaveSummary(date, minQty = 10) {
  // qty >= minQty 필터 적용해서 집계
  const rows = db.prepare(`
    SELECT
      item_name, kind_name,
      ROUND(unit_qty) AS unit_qty,
      unit,
      COUNT(*)            AS trade_count,
      SUM(quantity)       AS total_qty,
      MIN(price)          AS min_price,
      MAX(price)          AS max_price,
      AVG(price)          AS avg_price,
      SUM(price * quantity) / SUM(quantity) AS wavg_price
    FROM auction_records
    WHERE sale_date = ? AND quantity >= ? AND price > 0
    GROUP BY item_name, kind_name, ROUND(unit_qty), unit
  `).all(date, minQty);

  const upsert = db.transaction((summaries) => {
    for (const r of summaries) {
      upsertSummary.run({ sale_date: date, ...r });
    }
    return summaries.length;
  });
  return upsert(rows);
}

// ── 7일 추이 조회 ──────────────────────────────────────────────────────
function get7DayTrend(itemName, kindName = '') {
  return db.prepare(`
    SELECT sale_date, wavg_price, trade_count, total_qty
    FROM daily_summary
    WHERE item_name = ?
      AND (? = '' OR kind_name = ?)
    ORDER BY sale_date DESC
    LIMIT 7
  `).all(itemName, kindName, kindName);
}

// ── 폭락 품목 감지 ─────────────────────────────────────────────────────
// 기준: 최근 1일 가중평균이 직전 6일 평균보다 threshold% 이상 하락
function detectPriceDrop(threshold = 15) {
  // 품목별로 최근 7일 데이터 집계
  const items = db.prepare(`
    SELECT DISTINCT item_name, kind_name FROM daily_summary
    WHERE sale_date >= date('now', '-7 days')
  `).all();

  const drops = [];

  for (const { item_name, kind_name } of items) {
    const rows = db.prepare(`
      SELECT sale_date, wavg_price, trade_count
      FROM daily_summary
      WHERE item_name = ? AND kind_name = ?
        AND sale_date >= date('now', '-7 days')
        AND wavg_price > 0
      ORDER BY sale_date DESC
    `).all(item_name, kind_name);

    if (rows.length < 3) continue; // 데이터 부족

    const latest = rows[0];
    const prev   = rows.slice(1);  // 나머지 날짜들
    const prevAvg = prev.reduce((s, r) => s + r.wavg_price, 0) / prev.length;

    if (prevAvg <= 0) continue;

    const dropPct = ((prevAvg - latest.wavg_price) / prevAvg) * 100;

    if (dropPct >= threshold) {
      drops.push({
        item_name,
        kind_name,
        latest_date:  latest.sale_date,
        latest_price: Math.round(latest.wavg_price),
        prev_avg:     Math.round(prevAvg),
        drop_pct:     Math.round(dropPct * 10) / 10,
        days_of_data: rows.length,
      });
    }
  }

  return drops.sort((a, b) => b.drop_pct - a.drop_pct);
}

// ── 수집 날짜 확인 ─────────────────────────────────────────────────────
function getCollectedDates() {
  return db.prepare(`
    SELECT DISTINCT sale_date FROM auction_records ORDER BY sale_date DESC LIMIT 14
  `).all().map(r => r.sale_date);
}

function getRecordCount(date) {
  return db.prepare(`SELECT COUNT(*) as cnt FROM auction_records WHERE sale_date = ?`).get(date)?.cnt || 0;
}

module.exports = {
  db,
  saveRecords,
  buildAndSaveSummary,
  get7DayTrend,
  detectPriceDrop,
  getCollectedDates,
  getRecordCount,
};
