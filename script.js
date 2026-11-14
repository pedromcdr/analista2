// ============================================================
// analista.pt — script.js
// Todos os cálculos (CAPM, WACC, FCFF, DCF, Múltiplos, Qualidade)
// seguem a metodologia de Aswath Damodaran (ver aba Metodologia).
// ============================================================

const PSI_TICKERS = {
  "EDP - Energias de Portugal": "EDP.LS",
  "Galp Energia": "GALP.LS",
  "Jerónimo Martins": "JMT.LS",
  "NOS": "NOS.LS",
  "Banco Comercial Português (Millennium bcp)": "BCP.LS",
  "Sonae": "SON.LS",
  "EDP Renováveis": "EDPR.LS",
  "REN - Redes Energéticas Nacionais": "RENE.LS",
  "Semapa": "SEM.LS",
  "Corticeira Amorim": "COR.LS",
  "Altri": "ALTR.LS",
  "Mota-Engil": "EGL.LS",
  "CTT - Correios de Portugal": "CTT.LS",
  "Ibersol": "IBS.LS",
  "Novabase": "NBA.LS",
  "Pharol": "PHR.LS",
  "Ramada Investimentos": "RAM.LS",
  "Navigator Company": "NVG.LS",
  "Sonae Capital": "SONC.LS",
  "Inapa": "INA.LS",
};

let dadosAtuais = null;

// ---------------- FORMATAÇÃO ----------------
function fmtPct(x) {
  return (x === null || x === undefined || isNaN(x)) ? "N/D" : (x * 100).toFixed(2) + "%";
}
function fmtNum(x, casas = 2) {
  return (x === null || x === undefined || isNaN(x)) ? "N/D" : Number(x).toFixed(casas);
}
function fmtEur(x) {
  if (x === null || x === undefined || isNaN(x)) return "N/D";
  const abs = Math.abs(x);
  if (abs >= 1e9) return (x / 1e9).toLocaleString("pt-PT", { maximumFractionDigits: 2 }) + " mM€";
  if (abs >= 1e6) return (x / 1e6).toLocaleString("pt-PT", { maximumFractionDigits: 2 }) + " M€";
  return x.toLocaleString("pt-PT", { maximumFractionDigits: 2 }) + " €";
}

// ---------------- 1. DCF ----------------
function calcularCapm(rf, beta, erp) {
  return rf + beta * erp;
}
function calcularWacc(ke, kd, taxRate, pesoEquity, pesoDivida) {
  return ke * pesoEquity + kd * (1 - taxRate) * pesoDivida;
}
function calcularFcff(ebit, taxRate, depAmort, capex, deltaWc) {
  return ebit * (1 - taxRate) + (depAmort || 0) - (capex || 0) - (deltaWc || 0);
}
function valorTerminal(fluxoFinal, wacc, g) {
  if (wacc <= g) return null;
  return fluxoFinal * (1 + g) / (wacc - g);
}
function dcfValuation(fcffBase, wacc, gExplicito, gTerminal, anos, dividaLiquida, nAcoes) {
  const fluxos = [], descontados = [];
  let fc = fcffBase;
  for (let ano = 1; ano <= anos; ano++) {
    fc = fc * (1 + gExplicito);
    const fv = fc / Math.pow(1 + wacc, ano);
    fluxos.push(fc);
    descontados.push(fv);
  }
  const tv = valorTerminal(fluxos[fluxos.length - 1], wacc, gTerminal);
  const tvDescontado = tv !== null ? tv / Math.pow(1 + wacc, anos) : null;
  const valorEmpresa = descontados.reduce((a, b) => a + b, 0) + (tvDescontado || 0);
  const valorEquity = valorEmpresa - (dividaLiquida || 0);
  const valorPorAccao = nAcoes ? valorEquity / nAcoes : null;
  return { fluxos, descontados, tv, tvDescontado, valorEmpresa, valorEquity, valorPorAccao };
}

// ---------------- 2. MÚLTIPLOS ----------------
function calcularMultiplos(d) {
  const pe = (d.preco_atual && d.eps) ? d.preco_atual / d.eps : null;
  const evEbitda = (d.enterprise_value && d.ebitda) ? d.enterprise_value / d.ebitda : null;
  const pbv = (d.preco_atual && d.book_value_share) ? d.preco_atual / d.book_value_share : null;
  const evSales = (d.enterprise_value && d.total_revenue) ? d.enterprise_value / d.total_revenue : null;
  const peg = (pe && d.earnings_growth) ? pe / (d.earnings_growth * 100) : null;
  return {
    "P/E (Preço/Lucro)": pe,
    "EV/EBITDA": evEbitda,
    "P/BV (Preço/Valor Patrimonial)": pbv,
    "EV/Sales (EV/Receita)": evSales,
    "PEG Ratio": peg,
  };
}

// ---------------- 3. QUALIDADE ----------------
function calcularQualidade(d) {
  const taxRate = d.tax_rate || 0.21;
  const dividaTotal = d.divida_total || 0;
  const caixa = d.caixa || 0;
  const dividaLiquida = dividaTotal - caixa;
  const equity = d.equity_book || 0;
  const capitalInvestido = dividaTotal + equity;
  const nopat = (d.ebit !== null) ? d.ebit * (1 - taxRate) : null;
  const roic = (nopat !== null && capitalInvestido) ? nopat / capitalInvestido : null;
  const margemOperacional = (d.ebit !== null && d.total_revenue) ? d.ebit / d.total_revenue : null;
  const taxaReinvestimento = (d.capex !== null && d.lucro_liquido) ?
    ((d.capex - (d.dep_amort || 0)) / d.lucro_liquido) : null;
  return { roic, margemOperacional, taxaReinvestimento, dividaLiquida, dividaTotal, equity, taxRate };
}

// ---------------- UI: POPULAR SELECT ----------------
function popularSelectEmpresas() {
  const sel = document.getElementById("empresa");
  Object.entries(PSI_TICKERS).forEach(([nome, ticker]) => {
    const opt = document.createElement("option");
    opt.value = ticker;
    opt.textContent = nome;
    sel.appendChild(opt);
  });
  sel.value = "EDP.LS";
}

// ---------------- CARREGAR DADOS ----------------
async function carregarDados(ticker) {
  const status = document.getElementById("status");
  const conteudo = document.getElementById("conteudo");
  status.style.display = "block";
  status.className = "status";
  status.textContent = `A carregar ${ticker}...`;
  conteudo.style.display = "none";

  try {
    const resp = await fetch(`/api/dados?ticker=${encodeURIComponent(ticker)}`);
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.erro || "Erro desconhecido");
    dadosAtuais = json;
    status.style.display = "none";
    conteudo.style.display = "block";
    renderTudo();
  } catch (e) {
    status.className = "status erro";
    status.textContent = "⚠️ " + e.message;
  }
}

// ---------------- LER PRESSUPOSTOS DA SIDEBAR ----------------
function lerPressupostos() {
  return {
    rf: parseFloat(document.getElementById("rf").value) / 100,
    erp: parseFloat(document.getElementById("erp").value) / 100,
    gExplicito: parseFloat(document.getElementById("g-explicito").value) / 100,
    gTerminal: parseFloat(document.getElementById("g-terminal").value) / 100,
    anos: parseInt(document.getElementById("anos").value),
    kd: parseFloat(document.getElementById("kd").value) / 100,
  };
}

// ---------------- RENDERIZAÇÃO ----------------
function renderTudo() {
  const d = dadosAtuais;
  const p = lerPressupostos();

  document.getElementById("nome-empresa").textContent = d.nome;
  document.getElementById("kpi-preco").textContent = d.preco_atual ? `${d.preco_atual.toFixed(2)} ${d.moeda}` : "N/D";
  document.getElementById("kpi-mktcap").textContent = fmtEur(d.market_cap);
  document.getElementById("kpi-beta").textContent = fmtNum(d.beta);

  renderChartPreco(d);
  renderDcf(d, p);
  renderMultiplos(d);
  renderQualidade(d);
}

function renderChartPreco(d) {
  if (!d.historico_precos || d.historico_precos.length === 0) return;
  const x = d.historico_precos.map(p => p.data);
  const y = d.historico_precos.map(p => p.preco);
  Plotly.newPlot("chart-preco", [{
    x, y, type: "scatter", mode: "lines", line: { color: "#0F62FE" }, name: "Preço de Fecho"
  }], {
    title: `Evolução do Preço — ${d.nome}`,
    margin: { t: 40, b: 40 }, height: 340,
    yaxis: { title: d.moeda }
  }, { responsive: true, displayModeBar: false });
}

function card(label, valor, classe = "") {
  return `<div class="card"><span class="label">${label}</span><span class="valor ${classe}">${valor}</span></div>`;
}

function renderDcf(d, p) {
  const beta = d.beta || 1.0;
  const ke = calcularCapm(p.rf, beta, p.erp);
  document.getElementById("capm-cards").innerHTML =
    card("Rf (Taxa Livre de Risco)", fmtPct(p.rf)) +
    card("Beta (β)", fmtNum(beta)) +
    card("Custo de Capital Próprio (Ke)", fmtPct(ke));
  document.getElementById("capm-formula").textContent =
    `Ke = Rf + β × ERP = ${(p.rf*100).toFixed(2)}% + ${beta.toFixed(2)} × ${(p.erp*100).toFixed(2)}% = ${(ke*100).toFixed(2)}%`;

  const marketCap = d.market_cap || 0;
  const dividaTotal = d.divida_total || 0;
  const taxRate = d.tax_rate || 0.21;
  const vTotal = marketCap + dividaTotal;
  const pesoEquity = vTotal ? marketCap / vTotal : 1;
  const pesoDivida = 1 - pesoEquity;
  const wacc = calcularWacc(ke, p.kd, taxRate, pesoEquity, pesoDivida);

  document.getElementById("wacc-cards").innerHTML =
    card("Peso Capital Próprio (E/V)", fmtPct(pesoEquity)) +
    card("Peso Dívida (D/V)", fmtPct(pesoDivida)) +
    card("Taxa de Imposto (t)", fmtPct(taxRate)) +
    card("WACC", fmtPct(wacc));
  document.getElementById("wacc-formula").textContent =
    `WACC = Ke × (E/V) + Kd × (1-t) × (D/V) = ${(wacc*100).toFixed(2)}%`;

  let fcffBase;
  if (d.ebit === null) {
    document.getElementById("fcff-cards").innerHTML =
      `<div class="info-box">⚠️ Não foi possível obter o EBIT desta empresa automaticamente. Valor de FCFF indisponível.</div>`;
    fcffBase = 0;
  } else {
    fcffBase = calcularFcff(d.ebit, taxRate, d.dep_amort, d.capex, 0);
    document.getElementById("fcff-cards").innerHTML =
      card("EBIT", fmtEur(d.ebit)) +
      card("D&A", fmtEur(d.dep_amort)) +
      card("Capex", fmtEur(d.capex));
  }
  document.getElementById("fcff-formula").textContent =
    `FCFF = EBIT×(1-t) + D&A - Capex - ΔWC = ${fmtEur(fcffBase)}`;

  const dividaLiquida = dividaTotal - (d.caixa || 0);
  const nAcoes = d.shares_outstanding || 1;
  const resultado = dcfValuation(fcffBase, wacc, p.gExplicito, p.gTerminal, p.anos, dividaLiquida, nAcoes);

  const anosLabels = [];
  for (let i = 1; i <= p.anos; i++) anosLabels.push(`Ano ${i}`);
  anosLabels.push("Valor Terminal");
  const valoresDescontados = [...resultado.descontados, resultado.tvDescontado];

  Plotly.newPlot("chart-fluxos", [{
    x: anosLabels, y: valoresDescontados, type: "bar", marker: { color: "#0F62FE" }
  }], {
    title: "Fluxos de Caixa Descontados ao WACC",
    margin: { t: 40, b: 40 }, height: 340
  }, { responsive: true, displayModeBar: false });

  let tabelaHtml = `<table class="tabela-fluxos"><tr><th>Ano</th><th>Fluxo (€)</th><th>Fluxo Descontado (€)</th></tr>`;
  for (let i = 0; i < p.anos; i++) {
    tabelaHtml += `<tr><td>Ano ${i+1}</td><td>${fmtEur(resultado.fluxos[i])}</td><td>${fmtEur(resultado.descontados[i])}</td></tr>`;
  }
  tabelaHtml += `<tr><td>Valor Terminal</td><td>${fmtEur(resultado.tv)}</td><td>${fmtEur(resultado.tvDescontado)}</td></tr></table>`;
  document.getElementById("tabela-fluxos").innerHTML = tabelaHtml;

  const upside = (d.preco_atual && resultado.valorPorAccao) ? (resultado.valorPorAccao / d.preco_atual - 1) : null;
  document.getElementById("resultado-cards").innerHTML =
    card("Valor da Empresa (Enterprise Value)", fmtEur(resultado.valorEmpresa)) +
    card("Valor do Capital Próprio (Equity)", fmtEur(resultado.valorEquity)) +
    card("Valor Intrínseco por Ação", resultado.valorPorAccao ? `${resultado.valorPorAccao.toFixed(2)} ${d.moeda}` : "N/D",
         upside !== null ? (upside > 0 ? "positivo" : "negativo") : "");

  const msgEl = document.getElementById("resultado-msg");
  if (upside === null) {
    msgEl.className = ""; msgEl.textContent = "";
  } else if (upside > 0) {
    msgEl.className = "sub";
    msgEl.textContent = `Segundo este DCF, a ação estará subvalorizada em ${fmtPct(upside)} face ao preço de mercado.`;
  } else {
    msgEl.className = "sobre";
    msgEl.textContent = `Segundo este DCF, a ação estará sobrevalorizada em ${fmtPct(-upside)} face ao preço de mercado.`;
  }
}

function renderMultiplos(d) {
  const m = calcularMultiplos(d);
  let cardsHtml = "";
  const labels = [], valores = [];
  Object.entries(m).forEach(([nome, valor]) => {
    cardsHtml += card(nome, valor !== null ? fmtNum(valor) : "N/D");
    if (valor !== null) { labels.push(nome); valores.push(valor); }
  });
  document.getElementById("multiplos-cards").innerHTML = cardsHtml;

  if (labels.length) {
    Plotly.newPlot("chart-multiplos", [{
      x: labels, y: valores, type: "bar", marker: { color: "#0F62FE" }
    }], { title: "Múltiplos Atuais", margin: { t: 40, b: 80 }, height: 340 },
    { responsive: true, displayModeBar: false });
  } else {
    document.getElementById("chart-multiplos").innerHTML = "";
  }
}

function renderQualidade(d) {
  const q = calcularQualidade(d);
  document.getElementById("qualidade-cards").innerHTML =
    card("ROIC", fmtPct(q.roic)) +
    card("Margem Operacional", fmtPct(q.margemOperacional)) +
    card("Taxa de Reinvestimento", fmtPct(q.taxaReinvestimento)) +
    card("Dívida Líquida", fmtEur(q.dividaLiquida));

  document.getElementById("qualidade-detalhe").innerHTML =
    `<p>EBIT: ${fmtEur(d.ebit)} · Taxa de imposto: ${fmtPct(q.taxRate)} · Dívida Total: ${fmtEur(q.dividaTotal)} · Capital Próprio: ${fmtEur(q.equity)}</p>`;

  if (q.dividaTotal || q.equity) {
    Plotly.newPlot("chart-estrutura", [{
      labels: ["Dívida", "Capital Próprio"],
      values: [q.dividaTotal || 0, q.equity || 0],
      type: "pie"
    }], { title: "Estrutura de Capital", margin: { t: 40 }, height: 320 },
    { responsive: true, displayModeBar: false });
  }

  const hist = d.historico_financeiro || [];
  if (hist.length) {
    const anos = hist.map(h => h.ano);
    const receita = hist.map(h => h.receita);
    const ebit = hist.map(h => h.ebit);
    const lucro = hist.map(h => h.lucro_liquido);
    Plotly.newPlot("chart-historico", [
      { x: anos, y: receita, name: "Receita", type: "bar", marker: { color: "#0F62FE" } },
      { x: anos, y: ebit, name: "EBIT", type: "bar", marker: { color: "#0E8A5F" } },
      { x: anos, y: lucro, name: "Lucro Líquido", type: "bar", marker: { color: "#A56EFF" } },
    ], { title: "Evolução Financeira Anual", barmode: "group", margin: { t: 40 }, height: 320 },
    { responsive: true, displayModeBar: false });
  }
}

// ---------------- EVENTOS ----------------
document.addEventListener("DOMContentLoaded", () => {
  popularSelectEmpresas();

  document.getElementById("btn-carregar").addEventListener("click", () => {
    const custom = document.getElementById("ticker-custom").value.trim();
    const ticker = custom || document.getElementById("empresa").value;
    carregarDados(ticker);
  });

  document.getElementById("empresa").addEventListener("change", (e) => {
    document.getElementById("ticker-custom").value = "";
    carregarDados(e.target.value);
  });

  document.getElementById("anos").addEventListener("input", (e) => {
    document.getElementById("anos-label").textContent = e.target.value;
  });

  // Recalcular DCF instantaneamente ao mudar pressupostos (sem nova chamada à API)
  ["rf", "erp", "g-explicito", "g-terminal", "anos", "kd"].forEach(id => {
    document.getElementById(id).addEventListener("input", () => {
      if (dadosAtuais) renderDcf(dadosAtuais, lerPressupostos());
    });
  });

  // Tabs
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });

  carregarDados("EDP.LS");
});
