// api/search.js — Vercel Serverless Function (Groq - GRATUITO)
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tipo, query, pais } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query obrigatorio' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY nao configurada' });

  const paisLabel = { BR: 'Brasil', USA: 'EUA', ITA: 'Italia/UE' }[pais] || 'Brasil';
  const sistema = { BR: 'NCM', USA: 'HTS', ITA: 'NC/TARIC' }[pais] || 'NCM';

  let prompt = '';

  if (tipo === 'nome') {
    prompt = `Liste os 5 codigos ${sistema} mais relevantes para o produto "${query}" importado da China para ${paisLabel}.
Responda APENAS com JSON valido sem texto adicional:
[{"ncm":"0000.00.00","nome":"nome comercial curto","descricao":"descricao oficial","fobMedioKg":0.00,"relevancia":90}]
Use precos FOB reais de importacao China-${paisLabel} para cada produto especifico.`;

  } else if (tipo === 'codigo' || tipo === 'ncm') {
    prompt = `Voce e especialista em comercio exterior. Dados REAIS de importacao do produto ${sistema} ${query} importado da China para ${paisLabel}.
Responda APENAS com JSON valido sem texto adicional. Use valores FOB reais de mercado para este produto especifico (NAO use 2.50 como padrao - pesquise o valor real):
{
  "encontrado": true,
  "codigo": "${query}",
  "codigoFormatado": "codigo com pontuacao correta",
  "descricao": "descricao oficial do produto",
  "nomeComercial": "nome comercial curto em portugues",
  "fobMedioUn": 0.00,
  "fobMedioKg": 0.00,
  "volumeAnual": "estimativa ex: 1.2 milhoes unidades/ano",
  "tendencia": 0.0,
  "confianca": 75,
  "impostos": {"ii": 12, "ipi": 5, "pis": 2.1, "cofins": 9.65, "icms": 18, "sec301": 0, "ieepa": 10, "dazio": 0, "iva": 22},
  "historico": [
    {"mes": "Mar/25", "fobKg": 0.00, "kgTotal": 0},
    {"mes": "Fev/25", "fobKg": 0.00, "kgTotal": 0},
    {"mes": "Jan/25", "fobKg": 0.00, "kgTotal": 0},
    {"mes": "Dez/24", "fobKg": 0.00, "kgTotal": 0},
    {"mes": "Nov/24", "fobKg": 0.00, "kgTotal": 0},
    {"mes": "Out/24", "fobKg": 0.00, "kgTotal": 0}
  ],
  "alertas": [],
  "licencaPrevia": false,
  "equivalencias": {"BR": "NCM equivalente", "USA": "HTS equivalente", "ITA": "NC equivalente"},
  "fonte": "Groq/Llama estimativa baseada em dados de comercio exterior"
}`;

  } else if (tipo === 'hs6') {
    prompt = `Codigo HS6 ${query} para ${paisLabel}. Responda APENAS com JSON:
{"hs6":"${query}","descricao":"descricao do produto","nomeComercial":"nome curto","codigoLocal":"codigo local completo","sistema":"${sistema}","fobMedioUn":0.00,"fobMedioKg":0.00,"confianca":75,"impostos":{"ii":12,"ipi":5,"pis":2.1,"cofins":9.65,"icms":18,"sec301":0,"ieepa":10,"dazio":0,"iva":22},"equivalencias":{"BR":"NCM","USA":"HTS","ITA":"NC"},"alertas":[],"fonte":"HS System / Groq"}`;
  } else {
    prompt = `Produto "${query}" importado da China para ${paisLabel}. JSON apenas: [{"ncm":"0000.00.00","nome":"nome","descricao":"desc","fobMedioKg":0.00}]`;
  }

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        max_tokens: 1500,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: 'Voce e especialista em comercio exterior, importacao China-Brasil e classificacao aduaneira. Conhece precos FOB reais de mercado para produtos importados da China. Responda SEMPRE com JSON valido sem markdown, sem texto adicional. Use valores numericos reais e especificos para cada produto - nunca use valores padrao genericos.'
          },
          { role: 'user', content: prompt }
        ]
      })
    });

    const txt = await r.text();
    if (!r.ok) {
      console.error('Groq error:', r.status, txt.slice(0, 200));
      return res.status(502).json({ error: 'Groq error', status: r.status, details: txt.slice(0, 200) });
    }

    const data = JSON.parse(txt);
    const content = data.choices?.[0]?.message?.content || '';
    const clean = content.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      console.error('JSON parse error:', clean.slice(0, 300));
      return res.status(502).json({ error: 'JSON error', raw: clean.slice(0, 300) });
    }

    return res.status(200).json({ ok: true, data: parsed });

  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
