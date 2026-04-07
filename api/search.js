// api/search.js — Vercel Serverless Function (Groq)
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

  const paises = { BR: 'Brasil', USA: 'EUA', ITA: 'Italia/UE' };
  const sistemas = { BR: 'NCM', USA: 'HTS', ITA: 'NC/TARIC' };
  const paisLabel = paises[pais] || 'Brasil';
  const sistema = sistemas[pais] || 'NCM';

  // Impostos padrão por país
  const impostosPadrao = {
    BR: { ii: 12, ipi: 5, pis: 2.1, cofins: 9.65, icms: 18, sec301: 0, ieepa: 0, dazio: 0, iva: 0 },
    USA: { ii: 2, ipi: 0, pis: 0, cofins: 0, icms: 0, sec301: 7.5, ieepa: 10, dazio: 0, iva: 0 },
    ITA: { ii: 0, ipi: 0, pis: 0, cofins: 0, icms: 0, sec301: 0, ieepa: 0, dazio: 5, iva: 22 }
  };
  const imp = impostosPadrao[pais] || impostosPadrao.BR;

  let prompt = '';

  if (tipo === 'nome') {
    prompt = `Especialista em comércio exterior China-${paisLabel}. Liste 5 produtos com código ${sistema} para "${query}". Para cada um, informe o preço FOB real de importação da China. Responda APENAS com array JSON:
[
  {"ncm":"xxxx.xx.xx","nome":"nome comercial","descricao":"descrição oficial","fobMedioKg":PRECO_REAL},
  ...
]
Use preços FOB reais do mercado China-${paisLabel} para cada produto específico.`;

  } else if (tipo === 'hs6') {
    prompt = `Código HS6 ${query} para ${paisLabel}. Responda APENAS com JSON:
{"hs6":"${query}","descricao":"descrição do produto","nomeComercial":"nome curto","codigoLocal":"código ${sistema} completo","sistema":"${sistema}","fobMedioUn":PRECO_REAL,"fobMedioKg":PRECO_KG_REAL,"confianca":80,"impostos":${JSON.stringify(imp)},"equivalencias":{"BR":"NCM","USA":"HTS","ITA":"NC"},"alertas":[],"fonte":"HS/${sistema}"}
Substitua PRECO_REAL e PRECO_KG_REAL pelo preço FOB real deste produto importado da China.`;

  } else {
    // codigo ou ncm
    prompt = `Especialista em importação China-${paisLabel}. Dados do produto ${sistema} ${query}.

Responda APENAS com JSON (sem markdown):
{
  "encontrado": true,
  "codigo": "${query}",
  "codigoFormatado": "código com pontuação correta",
  "descricao": "descrição oficial do produto",
  "nomeComercial": "nome comercial em português",
  "fobMedioUn": INFORME_O_PRECO_FOB_REAL_POR_UNIDADE_EM_USD,
  "fobMedioKg": INFORME_O_PRECO_FOB_REAL_POR_KG_EM_USD,
  "volumeAnual": "estimativa de volume anual importado",
  "tendencia": 2.5,
  "confianca": 75,
  "impostos": ${JSON.stringify(imp)},
  "historico": [
    {"mes": "Mar/25", "fobKg": PRECO_REAL, "kgTotal": 50000},
    {"mes": "Fev/25", "fobKg": PRECO_REAL, "kgTotal": 48000},
    {"mes": "Jan/25", "fobKg": PRECO_REAL, "kgTotal": 45000},
    {"mes": "Dez/24", "fobKg": PRECO_REAL, "kgTotal": 42000},
    {"mes": "Nov/24", "fobKg": PRECO_REAL, "kgTotal": 46000},
    {"mes": "Out/24", "fobKg": PRECO_REAL, "kgTotal": 44000}
  ],
  "alertas": ["alertas regulatórios relevantes se houver"],
  "licencaPrevia": false,
  "equivalencias": {"BR": "código NCM", "USA": "código HTS", "ITA": "código NC"},
  "fonte": "estimativa baseada em dados reais de comércio exterior China-${paisLabel}"
}

IMPORTANTE: Substitua todos os valores PRECO_REAL pelo preço FOB real deste produto específico importado da China para ${paisLabel}. NÃO use valores genéricos como 12.50 ou 2.50. Pesquise o preço real de mercado.`;
  }

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        max_tokens: 1500,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: 'Você é especialista em comércio exterior China-' + paisLabel + ' com conhecimento profundo de preços FOB reais. Responda APENAS com JSON válido sem markdown. Use valores numéricos reais e específicos para cada produto.'
          },
          { role: 'user', content: prompt }
        ]
      })
    });

    const txt = await r.text();
    if (!r.ok) {
      console.error('Groq:', r.status, txt.slice(0, 300));
      return res.status(502).json({ error: 'Groq error', status: r.status, details: txt.slice(0, 300) });
    }

    const data = JSON.parse(txt);
    const content = (data.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      // Tentar extrair JSON do texto
      const match = content.match(/\{[\s\S]+\}|\[[\s\S]+\]/);
      if (match) {
        try { parsed = JSON.parse(match[0]); }
        catch(e2) { return res.status(502).json({ error: 'JSON error', raw: content.slice(0, 300) }); }
      } else {
        return res.status(502).json({ error: 'JSON error', raw: content.slice(0, 300) });
      }
    }

    return res.status(200).json({ ok: true, data: parsed });

  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
