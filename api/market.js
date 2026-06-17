// api/market.js — Vercel Serverless Function
// 네이버 금융 + Yahoo Finance에서 실시간 데이터 수집

const FIREBASE_URL = 'https://k-gongtam-default-rtdb.firebaseio.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300'); // 5분 캐시

  try {
    const [kospiData, usdkrwData, usIndexData, historyData, momentumData] = await Promise.allSettled([
      fetchKospi(),
      fetchUSDKRW(),
      fetchUSIndex(),
      fetchScoreHistory(),
      fetchKospiMomentum(),
    ]);

    const kospi    = kospiData.status   === 'fulfilled' ? kospiData.value   : { chg: 0, advancing: 500, declining: 400, newHigh: 30, newLow: 10, foreignNet: 0, vkospi: 20, hadFallback: true };
    const usdkrw   = usdkrwData.status  === 'fulfilled' ? usdkrwData.value  : 1400;
    const usIndex  = usIndexData.status === 'fulfilled' ? usIndexData.value : { score: 34, hadFallback: true };
    const usScore  = usIndex.score;
    const history  = historyData.status === 'fulfilled' ? historyData.value : [];
    const momentum = momentumData.status === 'fulfilled' ? momentumData.value : { ma125dev: 0, hadFallback: true };

    // 데이터 출처 중 하나라도 실패해서 추정값(폴백)을 썼는지 여부
    const isEstimated = !!kospi.hadFallback
      || usdkrwData.status !== 'fulfilled'
      || !!usIndex.hadFallback
      || !!momentum.hadFallback;

    res.status(200).json({
      kospiChg:   kospi.chg,
      ma125dev:   momentum.ma125dev, // 코스피 현재가의 125일 이동평균 대비 괴리율(%). 사상최고치/추세 반영용 모멘텀 지표
      advancing:  kospi.advancing,
      declining:  kospi.declining,
      newHigh:    kospi.newHigh,
      newLow:     kospi.newLow,
      foreignNet: kospi.foreignNet,
      vkospi:     kospi.vkospi,
      usdkrw,
      usScore,
      history, // [{date:'2026-06-16', score:67}, ...] 최근 7일 (오늘 제외, 실데이터 없으면 빈 배열)
      isEstimated, // true면 일부 데이터가 실시간 조회 실패로 추정값(폴백)임
      updatedAt: new Date().toISOString(),
    });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ── 최근 7일 점수 히스토리 (Firebase에서 조회) ──
async function fetchScoreHistory() {
  try {
    // KST 기준 오늘 날짜 구하기
    const kstNow = new Date(Date.now() + 9 * 3600000);
    const days = [];
    for (let i = 7; i >= 1; i--) {
      const d = new Date(kstNow.getTime() - i * 86400000);
      days.push(d.toISOString().slice(0, 10)); // YYYY-MM-DD
    }

    const r = await fetch(`${FIREBASE_URL}/scoreHistory.json`);
    if (!r.ok) return [];
    const all = await r.json();
    if (!all) return [];

    return days
      .filter(date => all[date] != null)
      .map(date => ({ date, score: Math.round(all[date]) }));
  } catch (_) {
    return [];
  }
}

// ── KOSPI 데이터 (네이버 금융 공개 API) ──
async function fetchKospi() {
  const r = await fetch(
    'https://polling.finance.naver.com/api/realtime/domestic/index/KOSPI',
    { headers: { Referer: 'https://finance.naver.com/' } }
  );
  const d = await r.json();
  const o = d.datas?.[0] || {};

  // 등락률
  const chg = parseFloat(o.fluctuationsRatio || 0);

  // 상승/하락 종목수 (네이버 마켓 인덱스)
  let advancing = 500, declining = 400, newHigh = 30, newLow = 10;
  let hadFallback = false;
  try {
    const r2 = await fetch(
      'https://polling.finance.naver.com/api/realtime/domestic/index/market-index',
      { headers: { Referer: 'https://finance.naver.com/' } }
    );
    const d2 = await r2.json();
    const market = d2.datas?.[0] || {};
    advancing = parseInt(market.advancingCount || 500);
    declining = parseInt(market.decliningCount || 400);
    newHigh   = parseInt(market.new52wHighCount || 30);
    newLow    = parseInt(market.new52wLowCount  || 10);
  } catch (_) {
    hadFallback = true;
  }

  // 외국인 순매수 (코스피 시장 전체, 억원 단위) + VKOSPI
  let foreignNet = 0, vkospi = 20;
  try {
    foreignNet = await fetchForeignNet();
  } catch (_) {
    hadFallback = true;
  }
  try {
    const r4 = await fetch(
      'https://polling.finance.naver.com/api/realtime/domestic/index/VKOSPI',
      { headers: { Referer: 'https://finance.naver.com/' } }
    );
    const d4 = await r4.json();
    vkospi = parseFloat(d4.datas?.[0]?.closePrice || 20);
  } catch (_) {
    hadFallback = true;
  }

  return { chg, advancing, declining, newHigh, newLow, foreignNet, vkospi, hadFallback };
}

// ── 외국인 순매수 (코스피 시장 전체, 단위: 억원) ──
// 네이버 금융 "투자자별 매매 동향" 페이지가 쓰는 비공개 HTML 엔드포인트를 파싱.
// sosok 파라미터를 비워두면 코스피 기준으로 응답됨.
async function fetchForeignNet() {
  const kstNow = new Date(Date.now() + 9 * 3600000);
  const bizdate = kstNow.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD

  const r = await fetch(
    `https://finance.naver.com/sise/investorDealTrendDay.naver?bizdate=${bizdate}&sosok=`,
    { headers: { Referer: 'https://finance.naver.com/' } }
  );
  if (!r.ok) throw new Error('investorDealTrendDay fetch failed');

  const html = await r.text();
  // 'date2' 클래스 td로 시작하는 첫 번째(최신) 데이터 행만 사용
  const rowMatch = html.match(/<tr>\s*<td class="date2">([^<]+)<\/td>([\s\S]*?)<\/tr>/);
  if (!rowMatch) throw new Error('investorDealTrendDay parse failed: no row found');

  const cells = [...rowMatch[2].matchAll(/<td[^>]*>([^<]*)<\/td>/g)].map(m => m[1].trim());
  // cells[0]=개인, cells[1]=외국인, cells[2]=기관계, ...
  const foreignNetStr = cells[1];
  if (foreignNetStr == null || foreignNetStr === '') throw new Error('investorDealTrendDay parse failed: empty value');

  const foreignNet = parseFloat(foreignNetStr.replace(/,/g, ''));
  if (Number.isNaN(foreignNet)) throw new Error('investorDealTrendDay parse failed: NaN');

  return foreignNet; // 억원 단위, 음수면 순매도
}

// ── 코스피 모멘텀 (CNN 방식: 125일 이동평균 대비 괴리율) ──
// CNN Fear & Greed Index의 Market Momentum 지표를 그대로 차용.
// 당일 등락률이 아니라 "지금 가격이 최근 6개월 추세선 대비 얼마나 높은가"를 측정하므로
// 사상 최고치 경신처럼 추세 위에서 계속 상승하는 상황을 정확히 포착함.
// 데이터 출처: 네이버 증권 모바일 차트 API (finance.naver.com 코스피 차트가 실제로 사용하는 엔드포인트,
// CORS 허용 + 일별 시가/고가/저가/종가 1년치 제공, 인증 불필요)
async function fetchKospiMomentum() {
  try {
    const kstNow = new Date(Date.now() + 9 * 3600000);
    const endTime = kstNow.toISOString().slice(0, 10).replace(/-/g, '');
    const startDate = new Date(kstNow.getTime() - 400 * 86400000); // 영업일 기준 200일 확보를 위해 여유있게 400일 전부터
    const startTime = startDate.toISOString().slice(0, 10).replace(/-/g, '');

    const r = await fetch(
      `https://m.stock.naver.com/front-api/external/chart/domestic/info?symbol=KOSPI&requestType=1&startTime=${startTime}&endTime=${endTime}&timeframe=day`,
      { headers: { Referer: 'https://finance.naver.com/sise/sise_index.naver?code=KOSPI' } }
    );
    if (!r.ok) throw new Error('naver chart fetch failed');

    const rows = await r.json();
    // rows[0]은 헤더(['날짜','시가','고가','저가','종가','거래량','외국인소진율']), 그 이후가 실데이터
    const closes = rows.slice(1).map(row => row[4]).filter(v => typeof v === 'number');
    if (closes.length < 125) throw new Error('insufficient history for 125-day MA');

    const latest = closes[closes.length - 1];
    const ma125 = closes.slice(-125).reduce((a, b) => a + b, 0) / 125;
    const ma125dev = (latest - ma125) / ma125 * 100; // %

    return { ma125dev, hadFallback: false };
  } catch (_) {
    return { ma125dev: 0, hadFallback: true };
  }
}

// ── 원달러 환율 (Yahoo Finance) ──
async function fetchUSDKRW() {
  const r = await fetch(
    'https://query1.finance.yahoo.com/v8/finance/chart/USDKRW=X?interval=1d&range=1d',
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  );
  const d = await r.json();
  const price = d.chart?.result?.[0]?.meta?.regularMarketPrice;
  return price ? Math.round(price) : 1400;
}

// ── 미국 공포탐욕지수 (CNN 대체: S&P500 기반 자체 계산) ──
async function fetchUSIndex() {
  try {
    const r = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=30d',
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    const d = await r.json();
    const closes = d.chart?.result?.[0]?.indicators?.quote?.[0]?.close || [];
    if (closes.length < 2) return { score: 50, hadFallback: true };
    const latest = closes[closes.length - 1];
    const prev   = closes[closes.length - 2];
    const avg25  = closes.slice(-25).reduce((a,b)=>a+b,0)/25;
    const chg    = (latest - prev) / prev * 100;
    const mom    = (latest - avg25) / avg25 * 100;
    // 간단한 공포탐욕 추정
    const score  = Math.round(50 + chg * 5 + mom * 3);
    return { score: Math.min(100, Math.max(0, score)), hadFallback: false };
  } catch (_) {
    return { score: 34, hadFallback: true };
  }
}
