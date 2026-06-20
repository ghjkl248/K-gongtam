// api/heatmap-us.js — 미국 시가총액 상위 30개 종목 히트맵 데이터
//
// 코스피/코스닥 히트맵(heatmap.js)과 달리, 미국은 "시가총액 상위 N개를 한 번에 알려주는"
// 안정적인 공개 API가 없음. Yahoo의 정식 screener API(largest_market_cap)는 crumb(보안
// 토큰)+쿠키 인증이 필요해서 매우 불안정하고 자주 끊김 — 실제로 여러 라이브러리에서
// "Invalid Crumb" 오류가 반복 보고됨.
//
// 대신 이미 market.js에서 안정적으로 검증된 v8/finance/chart 엔드포인트(인증 불필요)를
// 그대로 재사용. 이 엔드포인트는 가격은 주지만 시가총액 필드(marketCap)는 주지 않으므로,
// 시가총액 = 가격 × 발행주식수(고정값)로 직접 계산함. 발행주식수는 자사주 매입/추가발행
// 등으로 가끔 바뀌지만 몇 달 단위로만 변하는 값이라, 정기적으로(예: 분기마다) 사람이
// SHARES_OUTSTANDING 값만 갱신해주면 충분히 정확함.
//
// 종목 목록(2026년 6월 기준, 시가총액 내림차순)도 마찬가지로 고정 리스트로 관리.
// SpaceX(SPCX)는 2026년 6월 12일 나스닥 상장으로 신규 추가됨.

const STOCKS = [
  { ticker: 'NVDA',   name: 'NVIDIA',         shares: 24400 }, // 백만 주
  { ticker: 'GOOGL',  name: 'Alphabet',       shares: 5870 },
  { ticker: 'AAPL',   name: 'Apple',          shares: 14840 },
  { ticker: 'SPCX',   name: 'SpaceX',         shares: 13600 },
  { ticker: 'MSFT',   name: 'Microsoft',      shares: 7430 },
  { ticker: 'AMZN',   name: 'Amazon',         shares: 10500 },
  { ticker: 'TSM',    name: 'TSMC',           shares: 5190 },
  { ticker: 'AVGO',   name: 'Broadcom',       shares: 4700 },
  { ticker: 'TSLA',   name: 'Tesla',          shares: 3220 },
  { ticker: 'META',   name: 'Meta',           shares: 2210 },
  { ticker: 'MU',     name: 'Micron',         shares: 1100 },
  { ticker: 'BRK-B',  name: 'Berkshire',      shares: 2160 },
  { ticker: 'LLY',    name: 'Eli Lilly',      shares: 950 },
  { ticker: 'WMT',    name: 'Walmart',        shares: 8070 },
  { ticker: 'AMD',    name: 'AMD',            shares: 1620 },
  { ticker: 'JPM',    name: 'JPMorgan',       shares: 2660 },
  { ticker: 'ORCL',   name: 'Oracle',         shares: 2940 },
  { ticker: 'ASML',   name: 'ASML',           shares: 380 },
  { ticker: 'XOM',    name: 'ExxonMobil',     shares: 4170 },
  { ticker: 'V',      name: 'Visa',           shares: 1940 },
  { ticker: 'INTC',   name: 'Intel',          shares: 5090 },
  { ticker: 'JNJ',    name: 'J&J',            shares: 2420 },
  { ticker: 'CSCO',   name: 'Cisco',          shares: 3940 },
  { ticker: 'MA',     name: 'Mastercard',     shares: 920 },
  { ticker: 'ARM',    name: 'Arm',            shares: 1090 },
  { ticker: 'COST',   name: 'Costco',         shares: 440 },
  { ticker: 'CAT',    name: 'Caterpillar',    shares: 440 },
  { ticker: 'LRCX',   name: 'Lam Research',  shares: 1190 },
  { ticker: 'PLTR',   name: 'Palantir',       shares: 2530 },
  { ticker: 'ABBV',   name: 'AbbVie',         shares: 1750 },
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300'); // 5분 캐시 (코스피/코스닥 히트맵과 동일 정책)

  try {
    const results = await Promise.allSettled(
      STOCKS.map(s => fetchQuote(s.ticker))
    );

    const stocks = STOCKS.map((s, i) => {
      const r = results[i];
      if (r.status === 'rejected') {
        console.error(`heatmap-us: ${s.ticker} 조회 실패:`, r.reason?.message);
        return null;
      }
      const { price, change, changeRate } = r.value;
      return {
        code: s.ticker,
        name: s.name,
        price,
        change,
        changeRate,
        marketCap: price * s.shares, // 백만 달러 단위 (shares가 백만 주 단위이므로)
      };
    }).filter(Boolean);

    res.status(200).json({ stocks, updatedAt: new Date().toISOString() });
  } catch (e) {
    console.error('heatmap-us: handler 전역 예외:', e.message);
    res.status(500).json({ error: e.message });
  }
}

// market.js의 fetchUSIndex 등이 쓰는 것과 동일한 v8/finance/chart 엔드포인트.
// crumb/쿠키 인증이 필요 없어 v7/finance/quote(screener류)보다 훨씬 안정적임.
async function fetchQuote(ticker) {
  const r = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
    { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' }
  );
  if (!r.ok) throw new Error(`yahoo ${ticker} fetch failed: status ${r.status}`);
  const d = await r.json();
  const meta = d.chart?.result?.[0]?.meta;
  if (!meta) throw new Error(`yahoo ${ticker} response missing meta`);

  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose ?? meta.previousClose;
  if (price == null || prevClose == null) {
    throw new Error(`yahoo ${ticker} missing price fields`);
  }

  const change = price - prevClose;
  const changeRate = prevClose > 0 ? (change / prevClose) * 100 : 0;

  return { price, change, changeRate };
}
