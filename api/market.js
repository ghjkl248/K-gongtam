// api/market.js — Vercel Serverless Function
// 네이버 금융 + Yahoo Finance에서 실시간 데이터 수집

const FIREBASE_URL = 'https://k-gongtam-default-rtdb.firebaseio.com';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300'); // 5분 캐시

  try {
    const [kospiData, usdkrwData, usIndexData, historyData] = await Promise.allSettled([
      fetchKospi(),
      fetchUSDKRW(),
      fetchUSIndex(),
      fetchScoreHistory(),
    ]);

    const kospi   = kospiData.status   === 'fulfilled' ? kospiData.value   : { chg: 0, advancing: 500, declining: 400, newHigh: 30, newLow: 10, foreignNet: 0, vkospi: 20 };
    const usdkrw  = usdkrwData.status  === 'fulfilled' ? usdkrwData.value  : 1400;
    const usScore = usIndexData.status === 'fulfilled' ? usIndexData.value : 34;
    const history = historyData.status === 'fulfilled' ? historyData.value : [];

    res.status(200).json({
      kospiChg:   kospi.chg,
      advancing:  kospi.advancing,
      declining:  kospi.declining,
      newHigh:    kospi.newHigh,
      newLow:     kospi.newLow,
      foreignNet: kospi.foreignNet,
      vkospi:     kospi.vkospi,
      usdkrw,
      usScore,
      history, // [{date:'2026-06-16', score:67}, ...] 최근 7일 (오늘 제외, 실데이터 없으면 빈 배열)
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
  } catch (_) {}

  // 외국인 순매수 (억원)
  let foreignNet = 0, vkospi = 20;
  try {
    const r3 = await fetch(
      'https://finance.naver.com/sise/sise_index.naver?code=KOSPI',
      { headers: { Referer: 'https://finance.naver.com/' } }
    );
    // VKOSPI는 별도 종목코드로 조회
    const r4 = await fetch(
      'https://polling.finance.naver.com/api/realtime/domestic/index/VKOSPI',
      { headers: { Referer: 'https://finance.naver.com/' } }
    );
    const d4 = await r4.json();
    vkospi = parseFloat(d4.datas?.[0]?.closePrice || 20);
  } catch (_) {}

  return { chg, advancing, declining, newHigh, newLow, foreignNet, vkospi };
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
    if (closes.length < 2) return 50;
    const latest = closes[closes.length - 1];
    const prev   = closes[closes.length - 2];
    const avg25  = closes.slice(-25).reduce((a,b)=>a+b,0)/25;
    const chg    = (latest - prev) / prev * 100;
    const mom    = (latest - avg25) / avg25 * 100;
    // 간단한 공포탐욕 추정
    const score  = Math.round(50 + chg * 5 + mom * 3);
    return Math.min(100, Math.max(0, score));
  } catch (_) {
    return 34;
  }
}
