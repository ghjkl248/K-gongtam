// api/stocks.js — 삼성전자·SK하이닉스 실시간 시세 (10초 폴링 전용)
//
// market.js(5분 캐시)와 분리한 이유: 프론트엔드가 10초마다 호출해야 하는데, market.js는
// 코스피 지수/모멘텀/외인수급 등 무거운 호출을 여러 개 묶어서 5분 캐시로 운영 중이라
// 같은 엔드포인트를 10초마다 때리면 캐시 설계와 충돌함. 이 파일은 종목 시세 2개만
// 빠르게 가져오는 가벼운 별도 엔드포인트로 분리.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=8'); // 10초 폴링보다 살짝 짧게 캐시해 약간의 버퍼 확보

  try {
    const [samsung, skhynix, usdkrw, samsungOver, skhynixOver] = await Promise.allSettled([
      fetchStock('005930'), // 삼성전자 (네이버, 국내 정규장 기준)
      fetchStock('000660'), // SK하이닉스 (네이버, 국내 정규장 기준)
      fetchUSDKRW(),         // 환율도 10초마다 함께 갱신 (해외 환산가 계산용)
      fetchOverseasUsd('samsung'),  // 바이낸스 → 실패 시 프랑크푸르트 OTC로 폴백
      fetchOverseasUsd('skhynix'),
    ]);

    if (samsung.status === 'rejected') console.error('stocks: 삼성전자 조회 실패:', samsung.reason?.message);
    if (skhynix.status === 'rejected') console.error('stocks: SK하이닉스 조회 실패:', skhynix.reason?.message);
    if (usdkrw.status === 'rejected')  console.error('stocks: 환율 조회 실패:', usdkrw.reason?.message);
    if (samsungOver.status === 'rejected') console.error('stocks: 삼성전자 해외가 조회 실패:', samsungOver.reason?.message);
    if (skhynixOver.status === 'rejected') console.error('stocks: SK하이닉스 해외가 조회 실패:', skhynixOver.reason?.message);

    res.status(200).json({
      samsung: samsung.status === 'fulfilled' ? samsung.value : null,
      skhynix: skhynix.status === 'fulfilled' ? skhynix.value : null,
      usdkrw: usdkrw.status === 'fulfilled' ? usdkrw.value : null,
      samsungOverseas: samsungOver.status === 'fulfilled' ? samsungOver.value : null,   // {price, source}
      skhynixOverseas: skhynixOver.status === 'fulfilled' ? skhynixOver.value : null,
      // 진단용: 해외가 조회가 실패한 정확한 이유를 화면까지 전달해서, Vercel 로그를 보지 않고도
      // 어느 단계(네트워크 차단/심볼명 오류/응답 형식 변경 등)에서 막혔는지 바로 확인 가능하게 함
      debug: {
        samsungOverseasError: samsungOver.status === 'rejected' ? samsungOver.reason?.message : null,
        skhynixOverseasError: skhynixOver.status === 'rejected' ? skhynixOver.reason?.message : null,
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('stocks: handler 전역 예외:', e.message);
    res.status(500).json({ error: e.message });
  }
}

// 해외(USD) 추정가 소스: 바이비트(Bybit) → 실패 시 바이낸스(Binance) 순서로 시도.
// 둘 다 2026년 6월부터 SAMSUNGUSDT/SKHYNIXUSDT 무기한 선물(1배 추종, USDT 정산)을 상장했음.
// 바이낸스 호출이 status 451(Unavailable For Legal Reasons = 지역/법적 차단)로 거부되는 것이
// 확인되어, 완전히 다른 도메인(api.bybit.com)인 바이비트를 1차로 시도해 차단 영향을 분리함.
//
// 참고: 런던/프랑크푸르트의 GDR(SMSN, SSU 등)도 검토했으나, GDR 1주가 코스피 1주와 다른
// 환산 비율로 거래되어(예: SMSN GDR 1주 = 코스피 0.5주, 가격은 약 12배) 단순 환율 계산으로는
// 정확한 1배 비교가 불가능함. 비율이 종목마다 다르고 공개적으로 안정적이지 않아 제외함.
async function fetchOverseasUsd(label) {
  const SYMBOLS = { samsung: 'SAMSUNGUSDT', skhynix: 'SKHYNIXUSDT' };
  const symbol = SYMBOLS[label];

  try {
    return { price: await fetchBybitPerp(symbol), source: 'bybit' };
  } catch (e1) {
    console.error(`stocks: ${label} 바이비트 실패, 바이낸스로 폴백:`, e1.message);
    try {
      return { price: await fetchBinancePerp(symbol), source: 'binance' };
    } catch (e2) {
      console.error(`stocks: ${label} 바이낸스도 실패:`, e2.message);
      throw new Error(`${label}: 바이비트(${e1.message}) / 바이낸스(${e2.message}) 모두 실패`);
    }
  }
}

// 바이비트 V5 공개 마켓 데이터 API. 인증 불필요, category=linear가 USDT 무기한 선물.
async function fetchBybitPerp(symbol) {
  const r = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`);
  if (!r.ok) throw new Error(`bybit ${symbol} fetch failed: status ${r.status}`);
  const d = await r.json();
  if (d.retCode !== 0) throw new Error(`bybit ${symbol} retCode ${d.retCode}: ${d.retMsg}`);
  const item = d.result?.list?.[0];
  const price = parseFloat(item?.lastPrice);
  if (!price || Number.isNaN(price)) throw new Error(`bybit ${symbol} invalid price: ${JSON.stringify(d.result)}`);
  return price;
}

async function fetchBinancePerp(symbol) {
  const r = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`);
  if (!r.ok) throw new Error(`binance ${symbol} fetch failed: status ${r.status}`);
  const d = await r.json();
  const price = parseFloat(d.price);
  if (!price || Number.isNaN(price)) throw new Error(`binance ${symbol} invalid price: ${JSON.stringify(d)}`);
  return price; // USD(USDT 기준) 가격
}

// market.js의 fetchUSDKRW와 동일한 소스(Yahoo Finance). 10초 폴링 화면에서 환율도
// "살아있는 값"으로 보여주기 위해 이 파일에서도 독립적으로 조회함.
async function fetchUSDKRW() {
  const r = await fetch(
    'https://query1.finance.yahoo.com/v8/finance/chart/USDKRW=X?interval=1d&range=1d',
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  );
  if (!r.ok) throw new Error('yahoo USDKRW fetch failed: status ' + r.status);
  const d = await r.json();
  const price = d.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (!price) throw new Error('yahoo USDKRW response missing regularMarketPrice');
  return price;
}

// 네이버 응답의 숫자 필드는 "362,500"처럼 천 단위 쉼표가 포함된 문자열로 내려옴.
// parseFloat("362,500")은 쉼표에서 즉시 멈춰 362만 읽어버리는 버그가 있었음(₩362로 보이던 원인).
// 반드시 쉼표를 먼저 제거하고 숫자로 변환해야 함.
function toNum(v){
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const cleaned = String(v).replace(/,/g, '').trim();
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

// 네이버 금융 실시간 시세 API (market.js의 fetchKospi가 쓰는 것과 동일한 호스트/패턴).
// 종목코드 하나로 정규장 시세 + 프리장/애프터장 시세(overMarketPriceInfo)까지 함께 가져옴.
async function fetchStock(code) {
  const r = await fetch(
    `https://polling.finance.naver.com/api/realtime/domestic/stock/${code}`,
    { headers: { Referer: 'https://finance.naver.com/' } }
  );
  if (!r.ok) throw new Error(`naver stock ${code} fetch failed: status ${r.status}`);
  const d = await r.json();
  const o = d.datas?.[0];
  if (!o) throw new Error(`naver stock ${code} response missing datas[0]`);

  // overMarketPriceInfo: 정규장 시간 외(프리/애프터마켓)일 때 네이버가 함께 내려주는 시간외 시세.
  // tradingSessionType: 'PRE_MARKET' | 'AFTER_MARKET' 등. 정규장 중에는 이 필드가 없거나 비어있음.
  const over = o.overMarketPriceInfo || null;

  const price      = toNum(o.closePrice);
  const change     = toNum(o.compareToPreviousClosePrice);
  const changeRate = toNum(o.fluctuationsRatio);

  // 방어적 검증: 삼성전자/SK하이닉스는 항상 수만~수백만원대이므로, 비정상적으로 작은 값이
  // 나오면(파싱 오류 등) 0 대신 명확히 실패로 처리해서 화면에 이상한 가격이 뜨지 않게 함
  if (price < 1000) {
    throw new Error(`naver stock ${code} price looks invalid: raw=${o.closePrice}, parsed=${price}`);
  }

  return {
    code,
    name: o.stockName || '',
    price,                      // 정규장 기준 현재가/종가(원)
    change,                     // 전일대비(원), 음수면 하락
    changeRate,                 // 전일대비(%), 음수면 하락
    marketStatus: o.marketStatus || null, // 'OPEN' | 'CLOSE' 등 네이버 기준 정규장 상태
    overMarket: over ? {
      sessionType: over.tradingSessionType || null, // 'PRE_MARKET' | 'AFTER_MARKET'
      price: toNum(over.overPrice ?? over.price) || null,
      changeRate: toNum(over.overFluctuationsRatio ?? over.fluctuationsRatio) || null,
    } : null,
  };
}
