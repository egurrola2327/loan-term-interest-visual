// Loan Explorer Dashboard - Node version (no npm dependencies).
// Reads loan_dataset.csv once at startup, then answers filter requests.

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8080;
const ENVIRONMENT = process.env.ENVIRONMENT || "local";
const CSV_PATH = path.join(__dirname, "loan_dataset.csv");
const INDEX_PATH = path.join(__dirname, "public", "index.html");

// ---------------------------------------------------------------------------
// CSV loading
// ---------------------------------------------------------------------------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function loadLoans() {
  const text = fs.readFileSync(CSV_PATH, "utf8").replace(/^\uFEFF/, "");
  const [header, ...body] = parseCsv(text);
  const col = {};
  header.forEach((h, i) => (col[h.trim()] = i));

  const required = [
    "credit_score",
    "loan_term",
    "loan_purpose",
    "employment_status",
    "interest_rate",
    "loan_amount",
    "loan_paid_back",
  ];
  const missing = required.filter((name) => !(name in col));
  if (missing.length) {
    throw new Error("loan_dataset.csv is missing columns: " + missing.join(", "));
  }

  const truthy = new Set(["1", "1.0", "true", "yes"]);
  const loans = [];
  for (const r of body) {
    if (r.length < header.length) continue;
    const loan = {
      score: Number(r[col.credit_score]),
      term: Number(r[col.loan_term]),
      purpose: r[col.loan_purpose],
      employment: r[col.employment_status],
      rate: Number(r[col.interest_rate]),
      amount: Number(r[col.loan_amount]),
      paid: truthy.has(String(r[col.loan_paid_back]).trim().toLowerCase()) ? 1 : 0,
    };
    if (Number.isFinite(loan.score) && Number.isFinite(loan.rate) && Number.isFinite(loan.term)) {
      loans.push(loan);
    }
  }
  return loans;
}

const loans = loadLoans();
console.log(`Loaded ${loans.length} loans from loan_dataset.csv`);

// ---------------------------------------------------------------------------
// Options + summary
// ---------------------------------------------------------------------------
function buildOptions() {
  const terms = new Set();
  const purposes = new Set();
  const employment = new Set();
  let scoreMin = Infinity;
  let scoreMax = -Infinity;
  for (const l of loans) {
    terms.add(l.term);
    purposes.add(l.purpose);
    employment.add(l.employment);
    if (l.score < scoreMin) scoreMin = l.score;
    if (l.score > scoreMax) scoreMax = l.score;
  }
  return {
    environment: ENVIRONMENT,
    terms: [...terms].sort((a, b) => a - b),
    purposes: [...purposes].sort(),
    employment: [...employment].sort(),
    scoreMin,
    scoreMax,
  };
}

const options = buildOptions();

function summarize(f) {
  const terms = new Set((f.terms || []).map(Number));
  const purposes = new Set(f.purposes || []);
  const employment = new Set(f.employment || []);
  const scoreMin = Number(f.scoreMin);
  const scoreMax = Number(f.scoreMax);

  let n = 0;
  let rateSum = 0;
  let amountSum = 0;
  let paidSum = 0;
  const byBinTerm = new Map(); // "bin|term" -> {sum, count}
  const byBin = new Map(); // bin -> {sum, count}
  const byPurpose = new Map(); // purpose -> {sum, count}
  const termsSeen = new Set();

  const add = (map, key, value) => {
    const e = map.get(key);
    if (e) {
      e.sum += value;
      e.count += 1;
    } else {
      map.set(key, { sum: value, count: 1 });
    }
  };

  for (const l of loans) {
    if (
      !terms.has(l.term) ||
      !purposes.has(l.purpose) ||
      !employment.has(l.employment) ||
      l.score < scoreMin ||
      l.score > scoreMax
    ) {
      continue;
    }
    n++;
    rateSum += l.rate;
    amountSum += l.amount;
    paidSum += l.paid;
    const bin = Math.floor(l.score / 50) * 50;
    termsSeen.add(l.term);
    add(byBinTerm, bin + "|" + l.term, l.rate);
    add(byBin, bin, l.rate);
    add(byPurpose, l.purpose, l.rate);
  }

  if (n === 0) return { empty: true };

  const bins = [...byBin.keys()].sort((a, b) => a - b);
  const series = [...termsSeen]
    .sort((a, b) => a - b)
    .map((term) => {
      const rate = [];
      const count = [];
      const premium = [];
      for (const bin of bins) {
        const e = byBinTerm.get(bin + "|" + term);
        const binMean = byBin.get(bin).sum / byBin.get(bin).count;
        if (e) {
          const mean = e.sum / e.count;
          rate.push(mean);
          count.push(e.count);
          premium.push(mean - binMean);
        } else {
          rate.push(null);
          count.push(0);
          premium.push(null);
        }
      }
      return { term, rate, count, premium };
    });

  const purpose = [...byPurpose.entries()]
    .map(([name, e]) => ({ name, mean: e.sum / e.count, count: e.count }))
    .sort((a, b) => a.mean - b.mean);

  return {
    empty: false,
    kpis: {
      borrowers: n,
      avgRate: rateSum / n,
      avgAmount: amountSum / n,
      paidBack: (paidSum / n) * 100,
    },
    bins,
    series,
    purpose,
  };
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const indexHtml = fs.readFileSync(INDEX_PATH);

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(indexHtml);
    }
    if (url.pathname === "/api/options") {
      return sendJson(res, 200, options);
    }
    if (url.pathname === "/api/summary") {
      const filters = JSON.parse(url.searchParams.get("f") || "{}");
      return sendJson(res, 200, summarize(filters));
    }
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end("ok");
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: "Something went wrong reading that request." });
  }
});

server.listen(PORT, () => {
  console.log(`Loan Explorer running on port ${PORT} (environment: ${ENVIRONMENT})`);
});