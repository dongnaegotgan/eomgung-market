# -*- coding: utf-8 -*-
import sys
sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
"""
download_flexgate.py
flexgate 로그인 → 배송준비 주문 목록 → 엑셀 다운로드

사용: python download_flexgate.py <저장경로>
예시: python download_flexgate.py D:\경락가데이터서버\eomgung-market\order_output
"""
import sys, re, json, time, os
from datetime import datetime
import urllib.request, urllib.parse, urllib.error
import http.cookiejar

BASE   = 'https://dongnaegotgan.flexgate.co.kr'
INTRO  = 'https://intro.flexgate.co.kr'
UID    = 'dongnaegotgan'
UPW    = '곳간12!@'

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

def make_opener():
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    opener.addheaders = [
        ('User-Agent','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'),
        ('Accept','text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'),
        ('Accept-Language','ko-KR,ko;q=0.9,en;q=0.8'),
    ]
    return opener, cj

def login(opener):
    log('로그인 페이지 로드...')
    res = opener.open(f'{INTRO}/Mypage/Login')
    html = res.read().decode('utf-8')

    # encKey 추출
    m = re.search(r'name=["\']encKey["\'][^>]*value=["\']([^"\']*)["\']', html)
    enc_key = m.group(1) if m else ''
    log(f'encKey: {enc_key[:20]}...' if len(enc_key) > 20 else f'encKey: {repr(enc_key)}')

    # 로그인 POST
    login_data = urllib.parse.urlencode({
        'userId': UID,
        'password': UPW,
        'encKey': enc_key,
        'returnUrl': '/NewOrder/deal01?order_status=30&formtype=A&pagesize=1000'
    }).encode('utf-8')

    req = urllib.request.Request(
        f'{INTRO}/Mypage/Login',
        data=login_data,
        headers={'Content-Type': 'application/x-www-form-urlencoded',
                 'Referer': f'{INTRO}/Mypage/Login'},
        method='POST'
    )
    res = opener.open(req)
    final_url = res.geturl()
    log(f'로그인 후 URL: {final_url[:80]}')
    return final_url

def get_order_numbers(opener):
    log('배송준비 주문 목록 로드...')
    url = f'{BASE}/NewOrder/deal01?order_status=30&formtype=A&pagesize=1000'
    res = opener.open(url)
    html = res.read().decode('utf-8')

    # 주문번호 추출: input[name="chk"] value="..." data-mogidx="..."
    # 실제로는 mo_order_num = mogidx 값들
    mogidx_list = re.findall(r'data-mogidx=["\'](\d+)["\']', html)
    
    if not mogidx_list:
        # 다른 패턴 시도
        mogidx_list = re.findall(r'name=["\']chk["\'][^>]*value=["\']([^"\']+)["\']', html)
    
    log(f'주문 건수: {len(mogidx_list)}건')
    return mogidx_list

def create_excel(opener, mogidx_list):
    log('엑셀 파일 생성 요청...')
    post_data = urllib.parse.urlencode({
        'mo_order_num': ','.join(mogidx_list),
        'types': '3',
        'customno': '94'
    }).encode('utf-8')

    req = urllib.request.Request(
        f'{BASE}/NewOrder/CreateExcelIfile',
        data=post_data,
        headers={
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': f'{BASE}/NewOrder/deal01?order_status=30&formtype=A&pagesize=1000',
            'X-Requested-With': 'XMLHttpRequest'
        },
        method='POST'
    )
    res = opener.open(req)
    resp_text = res.read().decode('utf-8')
    log(f'서버 응답: {resp_text[:200]}')

    # 파일명 추출
    m = re.search(r'order_\d+\.xlsx', resp_text)
    if m:
        return m.group(0)
    
    try:
        data = json.loads(resp_text)
        return data.get('fileName') or data.get('filename') or data.get('data')
    except:
        return resp_text.strip().strip('"\'')

def download_excel(opener, file_name, out_dir):
    log(f'엑셀 다운로드: {file_name}')
    time.sleep(3)  # 서버 파일 생성 대기

    url = f'{BASE}/NewOrder/ExcelDownload?fileName={urllib.parse.quote(file_name)}'
    req = urllib.request.Request(url, headers={
        'Referer': f'{BASE}/NewOrder/deal01?order_status=30&formtype=A&pagesize=1000'
    })
    res = opener.open(req)
    
    content = res.read()
    content_type = res.headers.get('Content-Type', '')
    log(f'응답: {len(content)}bytes, {content_type}')

    if len(content) < 500 or 'html' in content_type.lower():
        # 재시도
        log('재시도...')
        time.sleep(3)
        res2 = opener.open(req)
        content = res2.read()
        log(f'재시도 응답: {len(content)}bytes')

    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, file_name)
    with open(out_path, 'wb') as f:
        f.write(content)
    
    log(f'저장 완료: {out_path}')
    return out_path

def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else '.'
    
    opener, cj = make_opener()
    
    # 1. 로그인
    final_url = login(opener)
    if 'Login' in final_url or 'login' in final_url:
        log('❌ 로그인 실패 - URL이 여전히 로그인 페이지')
        sys.exit(1)
    log('✅ 로그인 성공')

    # 2. 주문번호 목록
    mogidx_list = get_order_numbers(opener)
    if not mogidx_list:
        log('❌ 주문 없음')
        sys.exit(1)

    # 3. 엑셀 생성
    file_name = create_excel(opener, mogidx_list)
    if not file_name:
        log('❌ 파일명을 받지 못했습니다')
        sys.exit(1)
    log(f'파일명: {file_name}')

    # 4. 다운로드
    out_path = download_excel(opener, file_name, out_dir)
    
    # 성공 출력 (Node.js가 읽음)
    print(f'DOWNLOAD_OK:{out_path}')

if __name__ == '__main__':
    main()
