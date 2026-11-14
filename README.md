# analista.pt (versão Vercel)

Portal de avaliação de ações da bolsa portuguesa (PSI), baseado na
metodologia de Aswath Damodaran (DCF, Múltiplos, Qualidade).

**Arquitetura:**
- `api/index.py` — função serverless Python (Flask) que vai buscar dados
  em bruto ao Yahoo Finance via `yfinance` e devolve JSON
- `index.html` / `style.css` / `script.js` — frontend estático; todos os
  cálculos (CAPM, WACC, FCFF, DCF, múltiplos, qualidade) correm no
  browser em JavaScript, para os pressupostos serem ajustáveis em
  tempo real sem novas chamadas ao servidor

## Estrutura

```
analista_pt_vercel/
├── app.py             # Flask (raiz do projeto): / , /api/dados , /api/health
├── public/
│   ├── index.html
│   ├── style.css
│   └── script.js      # cálculos financeiros + gráficos (Plotly.js)
└── requirements.txt
```

Sem `vercel.json` e sem pasta `api/`: o Vercel deteta o `app.py`
sozinho. Se houver um `vercel.json` ou uma pasta `api/` antigos no
repositório, apaga-os.

## Testar localmente

```bash
pip install -r requirements.txt
python app.py
```
Isto arranca o Flask em `http://localhost:5000` (site) e `/api/dados?ticker=EDP.LS` (API).
Para testares o frontend completo localmente da forma mais fiel ao
Vercel, instala a CLI da Vercel:

```bash
npm install -g vercel
vercel dev
```
Isto simula o ambiente serverless e serve `index.html` + `/api/*` em
conjunto, tal como em produção.

## Publicar no Vercel

1. Cria um repositório Git com estes ficheiros (mantém a estrutura de pastas)
2. Em [vercel.com](https://vercel.com), "Add New Project" → importa o repositório
3. O Vercel deteta automaticamente o `app.py` como aplicação Flask
   (não precisas de escolher framework — deixa em "Other")
4. Deploy. A tua app fica disponível em `algo.vercel.app`
5. Em **Project Settings → Domains**, adiciona `analista.pt` e segue as
   instruções para apontar o DNS do domínio (registo A ou CNAME) para o Vercel

## Limitações a saber

- **Timeout**: o plano Hobby (grátis) do Vercel limita funções a 10
  segundos. Chamadas ao Yahoo Finance costumam ser rápidas, mas em
  "cold start" (primeira chamada após inatividade) podem por vezes
  aproximar-se do limite. Se acontecerem timeouts frequentes, o plano
  Pro sobe o limite para 60 segundos.
- **Tamanho da função**: `yfinance` + `pandas` + `numpy` cabem
  confortavelmente no limite de 250MB do Vercel, mas evita adicionar
  mais dependências pesadas.
- **Sem estado/cache entre pedidos**: cada chamada a `/api/dados` vai
  sempre buscar dados frescos ao Yahoo Finance (não há cache como no
  Streamlit `@st.cache_data`). Se quiseres cache, podes adicionar
  cabeçalhos `Cache-Control` na resposta Flask ou usar o KV/Blob Store
  da Vercel.
- Alguns campos financeiros (EBIT, D&A, capex) podem faltar para
  empresas menores, consoante o que a Yahoo Finance disponibiliza —
  esses casos aparecem como "N/D" no portal.
- Uso educativo — não constitui aconselhamento financeiro.
