/* ====================================================================
 * 엄궁 경락가 시세판 — 프론트엔드
 * -------------------------------------------------------------------
 * - /api/auction 호출 (server.js 프록시)
 * - 30초 자동 갱신 (토글 가능)
 * - 품목/품종/산지/출하자 실시간 검색
 * - 컬럼 정렬 (기본: 경락가 내림차순)
 * - 상단 티커 최근 낙찰 애니메이션
 * - API 미활성 시 샘플 데이터 모드
 * ==================================================================== */

(() => {
  // ---------- 상태 ----------
  const state = {
    items: [],
    filtered: [],
    sort: { key: 'price', dir: 'desc' },
    search: '',
    autoRefresh: true,
    refreshMs: 30_000,
    nextIn: 30,
    mockMode: false,
    view: 'table', // 'table' | 'summary' | 'chart'
    charts: { price: null, volume: null },
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const dom = {
    ticker:     $('tickerTrack'),
    clock:      $('clock'),
    updated:    $('lastUpdated'),
    next:       $('nextRefresh'),
    status:     $('status'),
    statusText: $('status').querySelector('.status__text'),

    banner:     $('errorBanner'),
    errorMsg:   $('errorMsg'),
    errorHint:  $('errorHint'),
    errorClose: $('errorClose'),

    count:      $('statCount'),
    avg:        $('statAvg'),
    vol:        $('statVolume'),
    top:        $('statTop'),
    topPrice:   $('statTopPrice'),

    search:     $('searchInput'),
    auto:       $('autoRefresh'),
    refreshBtn: $('refreshBtn'),
    csvBtn:     $('csvBtn'),
    viewBtns:   document.querySelectorAll('.view-btn'),

    viewTable:   $('viewTable'),
    viewSummary: $('viewSummary'),
    viewChart:   $('viewChart'),
    summaryBody: $('summaryBody'),
    priceChart:  $('priceChart'),
    volumeChart: $('volumeChart'),

    filterbar:    $('filterbar'),
    filterMarket: $('filterMarket'),
    filterCompany: $('filterCompany'),
    filterHint:   $('filterHint'),

    tbody:      $('tbody'),
    thead:      document.querySelector('#dataTable thead'),
    footNote:   $('footNote'),
  };

  // ---------- 포맷 ----------
  const fmtInt = (n) => (Number(n) || 0).toLocaleString('ko-KR');
  const fmtTime = (hhmmss) => {
    if (!hhmmss) return '—';
    const s = String(hhmmss).padStart(6, '0');
    return `${s.slice(0,2)}:${s.slice(2,4)}:${s.slice(4,6)}`;
  };

  // ---------- API ----------
  async function fetchAuctions() {
    if (state.mockMode) return loadMock();

    setStatus('loading', '불러오는 중');
    try {
      const res = await fetch('/api/auction?numOfRows=1000');
      const data = await res.json();

      if (!data.ok) {
        showError(data.error, data.hint);
        setStatus('error', 'API 오류');
        return;
      }

      // 필터 칩 표시
      renderFilterBar(data);

      // 실제 데이터인지 샘플인지에 따라 최상단 경고 스트라이프 표시
      const fakeBanner = document.getElementById('fakeBanner');
      const isFake = data.source && data.source !== 'live';
      if (fakeBanner) fakeBanner.hidden = !isFake;

      // 서버가 자동 폴백으로 mock 데이터를 준 경우 경고 배너 표시
      if (isFake) {
        showError(
          data.warning || '실제 API 호출이 실패하여 샘플 데이터를 표시합니다.',
          data.hint || 'API 키 활성화 완료 후 자동으로 실제 데이터로 전환됩니다.',
          'info'
        );
        setStatus('mock', data.source === 'mock-fallback' ? '폴백 (샘플)' : '샘플');
      } else {
        hideError();
        setStatus('ok', `${data.count}건 수신`);
      }

      state.items = data.items || [];
      applyFilterSort();
      render();
      dom.updated.textContent = new Date().toLocaleTimeString('ko-KR', { hour12: false });
      dom.footNote.textContent =
        `${data.source || 'live'} · 전체 ${data.rawCount ?? data.count}건 · 필터 후 ${data.count}건 · ${data.fetchedAt}`;
    } catch (err) {
      showError(err.message, '서버가 실행 중인지 확인하세요 (npm start).');
      setStatus('error', '연결 실패');
    }
  }

  function renderFilterBar(data) {
    const market  = data?.filter?.market;
    const company = data?.filter?.company;
    if (!market && !company) {
      dom.filterbar.hidden = true;
      return;
    }
    dom.filterbar.hidden = false;
    dom.filterMarket.textContent  = market  || '전체';
    dom.filterCompany.textContent = company || '전체';
    const raw = data.rawCount ?? data.count ?? 0;
    const kept = data.count ?? 0;
    const dateStr = data.date ? ` · ${data.date}` : '';
    dom.filterHint.innerHTML =
      `당일 전체 <strong>${raw.toLocaleString('ko-KR')}</strong>건 중 ` +
      `<strong>${kept.toLocaleString('ko-KR')}</strong>건 표시${dateStr}`;
  }

  function loadMock() {
    setStatus('mock', '샘플 데이터');
    hideError();
    state.items = MOCK_DATA;
    applyFilterSort();
    render();
    dom.updated.textContent = new Date().toLocaleTimeString('ko-KR', { hour12: false });
    dom.footNote.textContent = `샘플 데이터 ${MOCK_DATA.length}건 (실제 API 미사용)`;
  }

  // ---------- 렌더 ----------
  function applyFilterSort() {
    const q = state.search.trim().toLowerCase();
    let rows = state.items;

    if (q) {
      rows = rows.filter((r) =>
        [r.productName, r.kindName, r.origin, r.shipper, r.company]
          .some((v) => String(v || '').toLowerCase().includes(q))
      );
    }

    const { key, dir } = state.sort;
    rows = [...rows].sort((a, b) => {
      const av = a[key], bv = b[key];
      if (typeof av === 'number' && typeof bv === 'number') {
        return dir === 'asc' ? av - bv : bv - av;
      }
      return dir === 'asc'
        ? String(av).localeCompare(String(bv), 'ko')
        : String(bv).localeCompare(String(av), 'ko');
    });

    state.filtered = rows;
  }

  function render() {
    renderTable();
    renderStats();
    renderTicker();
    renderSortIndicators();
    renderSummary();
    renderCharts();
  }

  function setView(view) {
    state.view = view;
    dom.viewBtns.forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
    dom.viewTable.hidden   = view !== 'table';
    dom.viewSummary.hidden = view !== 'summary';
    dom.viewChart.hidden   = view !== 'chart';
    // 차트 뷰로 들어올 때 크기 재계산 필요
    if (view === 'chart') renderCharts();
  }

  // 품목별 집계
  function groupByProduct(items) {
    const groups = new Map();
    for (const r of items) {
      const key = r.productName || '(미기재)';
      if (!groups.has(key)) {
        groups.set(key, {
          name: key,
          count: 0,
          min: Infinity,
          max: -Infinity,
          totalPrice: 0,
          totalQty: 0,
          origins: new Map(),
        });
      }
      const g = groups.get(key);
      g.count += 1;
      if (r.price) {
        g.min = Math.min(g.min, r.price);
        g.max = Math.max(g.max, r.price);
        g.totalPrice += r.price;
      }
      g.totalQty += r.quantity || 0;
      if (r.origin) g.origins.set(r.origin, (g.origins.get(r.origin) || 0) + 1);
    }
    return [...groups.values()].map((g) => ({
      ...g,
      avg: g.count ? Math.round(g.totalPrice / g.count) : 0,
      min: g.min === Infinity ? 0 : g.min,
      max: g.max === -Infinity ? 0 : g.max,
      topOrigin: [...g.origins.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '—',
    }));
  }

  function renderSummary() {
    const groups = groupByProduct(state.filtered)
      .sort((a, b) => b.totalQty - a.totalQty);

    if (!groups.length) {
      dom.summaryBody.innerHTML = `
        <tr class="empty"><td colspan="7"><div class="empty__inner">
          <p>집계할 거래가 없습니다.</p>
        </div></td></tr>`;
      return;
    }

    const maxQty = Math.max(...groups.map((g) => g.totalQty), 1);
    dom.summaryBody.innerHTML = groups.map((g) => {
      const w = Math.max(4, Math.round((g.totalQty / maxQty) * 80));
      return `
        <tr>
          <td><strong>${escapeHtml(g.name)}</strong></td>
          <td class="num">${fmtInt(g.count)}</td>
          <td class="num mono">${fmtInt(g.min)}</td>
          <td class="num price">${fmtInt(g.avg)}</td>
          <td class="num mono">${fmtInt(g.max)}</td>
          <td class="num"><span class="mini-bar" style="width:${w}px"></span>${fmtInt(g.totalQty)}</td>
          <td>${escapeHtml(g.topOrigin)}</td>
        </tr>
      `;
    }).join('');
  }

  // Chart.js — 차트 2개 (평균가 / 거래량)
  function renderCharts() {
    if (typeof Chart === 'undefined') return; // 아직 로드 전

    const groups = groupByProduct(state.filtered);
    const byPrice  = [...groups].sort((a, b) => b.avg - a.avg).slice(0, 12);
    const byVolume = [...groups].sort((a, b) => b.totalQty - a.totalQty).slice(0, 12);

    drawBar(dom.priceChart, 'price', {
      labels: byPrice.map((g) => g.name),
      data:   byPrice.map((g) => g.avg),
      color:  'rgba(244,180,26,.85)',
      border: 'rgba(244,180,26,1)',
    });

    drawBar(dom.volumeChart, 'volume', {
      labels: byVolume.map((g) => g.name),
      data:   byVolume.map((g) => g.totalQty),
      color:  'rgba(142,195,107,.75)',
      border: 'rgba(142,195,107,1)',
    });
  }

  function drawBar(canvas, key, { labels, data, color, border }) {
    const ctx = canvas.getContext('2d');
    if (state.charts[key]) state.charts[key].destroy();

    state.charts[key] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: color,
          borderColor: border,
          borderWidth: 1,
          borderRadius: 4,
          maxBarThickness: 42,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0a110d',
            borderColor: 'rgba(244,180,26,.4)',
            borderWidth: 1,
            titleColor: '#f5efe0',
            bodyColor: '#eae3cf',
            padding: 10,
            callbacks: {
              label: (ctx_) => `${fmtInt(ctx_.parsed.y)}`,
            },
          },
        },
        scales: {
          x: {
            grid:   { color: 'rgba(255,255,255,.04)' },
            ticks:  { color: '#a8b4a2', font: { family: 'Noto Sans KR', size: 11 } },
          },
          y: {
            grid:   { color: 'rgba(255,255,255,.04)' },
            ticks:  {
              color: '#a8b4a2',
              font: { family: 'JetBrains Mono', size: 11 },
              callback: (v) => fmtInt(v),
            },
          },
        },
      },
    });
  }

  // CSV 내보내기
  function exportCsv() {
    const rows = state.filtered;
    if (!rows.length) return;

    const header = ['시각','품목','품종','등급','산지','규격','중량','수량','경락가','도매법인','출하자'];
    const csvRows = [header.join(',')];

    for (const r of rows) {
      const line = [
        fmtTime(r.saleTime),
        r.productName, r.kindName, r.grade,
        r.origin, r.unit, r.weight,
        r.quantity, r.price,
        r.company, r.shipper,
      ].map(csvCell).join(',');
      csvRows.push(line);
    }

    // 엑셀 한글 깨짐 방지용 BOM
    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `eomgung-auction-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function csvCell(v) {
    const s = String(v ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function renderTable() {
    if (!state.filtered.length) {
      dom.tbody.innerHTML = `
        <tr class="empty"><td colspan="10"><div class="empty__inner">
          <p>표시할 거래가 없습니다.${state.search ? ' 검색어를 바꿔보세요.' : ''}</p>
        </div></td></tr>`;
      return;
    }

    const html = state.filtered.map((r) => `
      <tr>
        <td class="mono">${escapeHtml(fmtTime(r.saleTime))}</td>
        <td><strong>${escapeHtml(r.productName) || '—'}</strong></td>
        <td>${escapeHtml(r.kindName) || '—'}</td>
        <td>${r.grade ? `<span class="grade-pill" data-grade="${escapeHtml(r.grade)}">${escapeHtml(r.grade)}</span>` : '—'}</td>
        <td>${escapeHtml(r.origin) || '—'}</td>
        <td>${escapeHtml(r.unit) || '—'}${r.weight ? ` · ${escapeHtml(r.weight)}` : ''}</td>
        <td class="num">${r.quantity ? fmtInt(r.quantity) : '—'}</td>
        <td class="num price">${r.price ? fmtInt(r.price) : '—'}</td>
        <td>${escapeHtml(r.company) || '—'}</td>
        <td>${escapeHtml(r.shipper) || '—'}</td>
      </tr>
    `).join('');

    dom.tbody.innerHTML = html;
  }

  function renderStats() {
    const items = state.filtered;
    if (!items.length) {
      dom.count.textContent = '—';
      dom.avg.textContent = '—';
      dom.vol.textContent = '—';
      dom.top.textContent = '—';
      dom.topPrice.textContent = '—';
      return;
    }

    const totalPrice = items.reduce((s, r) => s + (r.price || 0), 0);
    const avg = Math.round(totalPrice / items.length);
    const vol = items.reduce((s, r) => s + (r.quantity || 0), 0);
    const top = items.reduce((m, r) => (r.price > (m?.price || 0) ? r : m), null);

    dom.count.textContent = fmtInt(items.length);
    dom.avg.textContent = fmtInt(avg);
    dom.vol.textContent = fmtInt(vol);
    dom.top.textContent = top ? `${top.productName || '—'} · ${top.kindName || ''}` : '—';
    dom.topPrice.textContent = top ? `${fmtInt(top.price)}원` : '—';
  }

  function renderTicker() {
    const items = state.items.slice(0, 25);
    if (!items.length) {
      dom.ticker.innerHTML = `<span class="ticker__item muted">수신 대기…</span>`;
      return;
    }
    const one = items.map((r) => `
      <span class="ticker__item">
        <strong>${escapeHtml(r.productName || '—')}</strong>
        <span>${escapeHtml(r.kindName || '')}</span>
        <span class="px">${fmtInt(r.price)}원</span>
        <span class="muted">/ ${escapeHtml(r.unit || '')}</span>
      </span>
    `).join('');
    // 무한 스크롤처럼 보이게 복제
    dom.ticker.innerHTML = one + one;
  }

  function renderSortIndicators() {
    dom.thead.querySelectorAll('th').forEach((th) => {
      const k = th.dataset.sort;
      if (!k) return;
      const base = th.textContent.replace(/[▾▴]\s*$/, '').trim();
      if (k === state.sort.key) {
        th.innerHTML = `${base} ${state.sort.dir === 'asc' ? '▴' : '▾'}`;
      } else {
        th.textContent = base;
      }
    });
  }

  // ---------- 상태 배지 ----------
  function setStatus(state_, text) {
    dom.status.dataset.state = state_;
    dom.statusText.textContent = text;
  }

  function showError(msg, hint, kind = 'error') {
    dom.errorMsg.textContent = msg || '알 수 없는 오류';
    dom.errorHint.textContent = hint || '';
    dom.banner.hidden = false;
    dom.banner.classList.toggle('banner--info', kind === 'info');
    const title = dom.banner.querySelector('.banner__title');
    title.textContent = kind === 'info' ? '샘플 데이터 표시 중' : 'API 호출 실패';
  }
  function hideError() { dom.banner.hidden = true; }

  // ---------- 유틸 ----------
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ---------- 이벤트 바인딩 ----------
  dom.search.addEventListener('input', (e) => {
    state.search = e.target.value;
    applyFilterSort(); render();
  });

  dom.auto.addEventListener('change', (e) => {
    state.autoRefresh = e.target.checked;
    state.nextIn = state.refreshMs / 1000;
  });

  dom.refreshBtn.addEventListener('click', () => {
    fetchAuctions();
    state.nextIn = state.refreshMs / 1000;
  });

  dom.csvBtn.addEventListener('click', exportCsv);

  dom.viewBtns.forEach((btn) => {
    btn.addEventListener('click', () => setView(btn.dataset.view));
  });

  dom.errorClose.addEventListener('click', hideError);

  dom.thead.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const key = th.dataset.sort;
    if (state.sort.key === key) {
      state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      state.sort.key = key;
      state.sort.dir = ['price', 'quantity', 'saleTime'].includes(key) ? 'desc' : 'asc';
    }
    applyFilterSort(); render();
  });

  // ---------- 시계 & 자동갱신 카운트다운 ----------
  setInterval(() => {
    dom.clock.textContent = new Date().toLocaleTimeString('ko-KR', { hour12: false });
    if (state.autoRefresh && !state.mockMode) {
      state.nextIn -= 1;
      if (state.nextIn <= 0) {
        state.nextIn = state.refreshMs / 1000;
        fetchAuctions();
      }
      dom.next.textContent = `${state.nextIn}s`;
    } else {
      dom.next.textContent = state.mockMode ? 'mock' : 'off';
    }
  }, 1000);

  // ---------- 샘플 데이터 (API 활성화 전 UI 확인용) ----------
  const MOCK_DATA = [
    { saleTime:'060512', productName:'사과',   kindName:'부사',    grade:'특', unit:'10kg', weight:'10kg', origin:'경북 안동', quantity:120, price:58000, company:'동남청과',  shipper:'안동사과작목반' },
    { saleTime:'060745', productName:'배',     kindName:'신고',    grade:'상', unit:'15kg', weight:'15kg', origin:'전남 나주', quantity:80,  price:42000, company:'부산원예',  shipper:'나주배영농법인' },
    { saleTime:'061023', productName:'감귤',   kindName:'노지',    grade:'특', unit:'5kg',  weight:'5kg',  origin:'제주',     quantity:200, price:18500, company:'한국청과',  shipper:'서귀포감협' },
    { saleTime:'061210', productName:'양배추', kindName:'일반',    grade:'상', unit:'8kg',  weight:'8kg',  origin:'강원 평창', quantity:340, price:9200,  company:'부산청과',  shipper:'평창영농조합' },
    { saleTime:'061342', productName:'대파',   kindName:'진주대파', grade:'특', unit:'1단',  weight:'1kg',  origin:'경남 진주', quantity:150, price:3500,  company:'동남청과',  shipper:'진주대파작목반' },
    { saleTime:'061455', productName:'상추',   kindName:'청상추',  grade:'상', unit:'4kg',  weight:'4kg',  origin:'충남 논산', quantity:90,  price:28000, company:'부산원예',  shipper:'논산채소' },
    { saleTime:'061612', productName:'토마토', kindName:'완숙',    grade:'특', unit:'5kg',  weight:'5kg',  origin:'전남 담양', quantity:220, price:31000, company:'한국청과',  shipper:'담양원예' },
    { saleTime:'061745', productName:'오이',   kindName:'백다다기', grade:'상', unit:'50본', weight:'15kg', origin:'경북 상주', quantity:110, price:24500, company:'부산청과',  shipper:'상주오이' },
    { saleTime:'061855', productName:'감자',   kindName:'수미',    grade:'상', unit:'20kg', weight:'20kg', origin:'강원 정선', quantity:60,  price:35000, company:'동남청과',  shipper:'정선감자' },
    { saleTime:'062003', productName:'고구마', kindName:'호박',    grade:'특', unit:'10kg', weight:'10kg', origin:'전남 해남', quantity:85,  price:38000, company:'부산원예',  shipper:'해남고구마' },
    { saleTime:'062133', productName:'양파',   kindName:'조생',    grade:'상', unit:'20kg', weight:'20kg', origin:'경남 창녕', quantity:420, price:15000, company:'한국청과',  shipper:'창녕양파' },
    { saleTime:'062245', productName:'마늘',   kindName:'난지',    grade:'특', unit:'10kg', weight:'10kg', origin:'경남 남해', quantity:70,  price:68000, company:'부산청과',  shipper:'남해마늘' },
    { saleTime:'062410', productName:'배추',   kindName:'월동',    grade:'상', unit:'3포기', weight:'9kg',  origin:'전남 해남', quantity:300, price:11500, company:'동남청과',  shipper:'해남배추' },
    { saleTime:'062520', productName:'무',     kindName:'가을',    grade:'상', unit:'18kg', weight:'18kg', origin:'제주',     quantity:180, price:13200, company:'부산원예',  shipper:'제주무작목반' },
    { saleTime:'062644', productName:'피망',   kindName:'홍피망',  grade:'특', unit:'5kg',  weight:'5kg',  origin:'충북 청주', quantity:55,  price:45000, company:'한국청과',  shipper:'청주피망' },
  ];

  // ---------- 시작 ----------
  fetchAuctions();
})();
