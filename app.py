"""
analista.pt — Flask (Vercel). Entrypoint: app.py na raiz do projeto

Endpoint único: GET /api/dados?ticker=EDP.LS
Devolve em JSON os dados em bruto do Yahoo Finance (via yfinance)
necessários para o frontend calcular DCF, Múltiplos e Qualidade.
Todos os cálculos financeiros acontecem no browser (script.js),
para que ajustar pressupostos (Rf, ERP, g...) seja instantâneo.
"""

import math
import os
import numpy as np
import pandas as pd
import yfinance as yf
from flask import Flask, jsonify, request, send_from_directory

# O frontend (index.html, style.css, script.js) vive em ../public
PUBLIC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "public"))

app = Flask(__name__, static_folder=None)


@app.route("/")
def home():
    return send_from_directory(PUBLIC_DIR, "index.html")


@app.route("/<path:filename>")
def ficheiros_estaticos(filename):
    """Serve style.css, script.js, etc. (fallback caso o Vercel encaminhe tudo para o Flask)."""
    return send_from_directory(PUBLIC_DIR, filename)


@app.errorhandler(404)
def nao_encontrado(e):
    # Mostra o caminho que o Flask recebeu, para facilitar o diagnóstico no Vercel
    return jsonify({"erro": "Não encontrado", "caminho_recebido": request.path}), 404


def clean(x):
    """Converte NaN/Inf/np types em algo serializável em JSON (None em vez de NaN)."""
    if x is None:
        return None
    if isinstance(x, (np.floating, np.integer)):
        x = x.item()
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return None
    return x


def get_val(df: pd.DataFrame, row_names, col=0):
    if df is None or df.empty:
        return None
    for name in row_names:
        if name in df.index:
            try:
                return clean(float(df.loc[name].iloc[col]))
            except Exception:
                continue
    return None


def serie_historica_financeira(fin: pd.DataFrame):
    """Extrai Receita, EBIT e Lucro Líquido por ano para o gráfico histórico."""
    if fin is None or fin.empty:
        return []
    linhas = {"Total Revenue": "receita", "EBIT": "ebit",
              "Operating Income": "ebit", "Net Income": "lucro_liquido"}
    presentes = [l for l in linhas if l in fin.index]
    if not presentes:
        return []
    resultado = []
    for col in fin.columns:
        try:
            ano = str(col.year) if hasattr(col, "year") else str(col)
        except Exception:
            ano = str(col)
        ponto = {"ano": ano}
        for linha in presentes:
            chave = linhas[linha]
            if chave not in ponto or ponto.get(chave) is None:
                ponto[chave] = get_val(fin, [linha], col=fin.columns.get_loc(col))
        resultado.append(ponto)
    return resultado


def serie_precos(hist: pd.DataFrame, pontos_max: int = 250):
    if hist is None or hist.empty:
        return []
    h = hist["Close"].dropna()
    if len(h) > pontos_max:
        passo = len(h) // pontos_max
        h = h.iloc[::passo]
    return [{"data": idx.strftime("%Y-%m-%d"), "preco": clean(float(v))} for idx, v in h.items()]


@app.route("/api/dados")
def dados():
    ticker = request.args.get("ticker", "").strip()
    if not ticker:
        return jsonify({"erro": "Parâmetro 'ticker' em falta."}), 400

    try:
        t = yf.Ticker(ticker)
        info = t.info or {}
        hist = t.history(period="2y")
        fin = t.financials
        bs = t.balance_sheet
        cf = t.cashflow
    except Exception as e:
        return jsonify({"erro": f"Não foi possível obter dados para '{ticker}': {e}"}), 502

    if not info or (info.get("currentPrice") is None and info.get("regularMarketPrice") is None):
        return jsonify({"erro": f"Ticker '{ticker}' sem dados disponíveis no Yahoo Finance."}), 404

    divida_total = get_val(bs, ["Total Debt"])
    if divida_total is None:
        lt = get_val(bs, ["Long Term Debt"]) or 0
        st = get_val(bs, ["Current Debt", "Short Long Term Debt"]) or 0
        divida_total = lt + st

    resposta = {
        "ticker": ticker,
        "nome": info.get("longName") or info.get("shortName") or ticker,
        "moeda": info.get("currency", "EUR"),
        "preco_atual": clean(info.get("currentPrice") or info.get("regularMarketPrice")),
        "market_cap": clean(info.get("marketCap")),
        "beta": clean(info.get("beta")) or 1.0,
        "eps": clean(info.get("trailingEps")),
        "book_value_share": clean(info.get("bookValue")),
        "enterprise_value": clean(info.get("enterpriseValue")),
        "ebitda": clean(info.get("ebitda")),
        "total_revenue": clean(info.get("totalRevenue")),
        "earnings_growth": clean(info.get("earningsGrowth")),
        "shares_outstanding": clean(info.get("sharesOutstanding")),
        "tax_rate": clean(info.get("effectiveTaxRate")) or 0.21,
        "ebit": get_val(fin, ["EBIT", "Operating Income"]),
        "dep_amort": get_val(cf, ["Depreciation And Amortization", "Depreciation"]),
        "capex": abs(get_val(cf, ["Capital Expenditure"]) or 0) or None,
        "lucro_liquido": get_val(fin, ["Net Income"]),
        "divida_total": clean(divida_total),
        "caixa": get_val(bs, ["Cash And Cash Equivalents", "Cash"]),
        "equity_book": get_val(bs, ["Common Stock Equity", "Stockholders Equity"]),
        "historico_precos": serie_precos(hist),
        "historico_financeiro": serie_historica_financeira(fin),
    }
    return jsonify(resposta)


@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})


# Ponto de entrada WSGI para o runtime Python da Vercel
if __name__ == "__main__":
    app.run(debug=True, port=5000)
