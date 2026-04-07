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

  const paisLabel = { BR:'Brasil', USA:'EUA', ITA:'Italia/UE' }[pais] || 'Brasil';
  const sistema = { BR:'NCM', USA:'HTS', ITA:'NC/TARIC' }[pais] || 'NCM';

  let sysPrompt = 'Voce e especialista em comercio exterior. Responda APENAS com JSON valido sem markdown.';
  let userPrompt = '';

  if (tipo === 'nome') {
    userPrompt = `Liste 5 codigos ${sistema} para "${query}" importado da China para ${paisLabel}. JSON: [{"ncm":"0000.00.00","nome":"nome","descricao":"desc","fobMedioKg":0}]`;
  } else if (tipo === 'hs6') {
    userPrompt = `HS6 ${query} para ${paisLabel}. JSON: {"hs6":"${query}","descricao":"desc","nomeComercial":"nome","codigoLocal":"local","sistema":"${sistema}","fobMedioUn":0,"fobMedioKg":0,"confianca":75,"impostos":{"ii":0,"ipi":0,"pis":2.1,"cofins":9.65,"icms":18,"dazio":0,"iva":22},"equivalencias":{"BR":"ncm","USA":"hts","ITA":"nc"},"alertas":[],"fonte":"Groq"}`;
  } else {
    userPrompt = `Dados do ${sistema} ${query} importado da China para ${paisLabel}. JSON: {"encontrado":true,"codigo":"${query}","codigoFormatado":"${query}","descricao":"descricao","nomeComercial":"nome","fobMedioUn":0,"fobMedioKg":0,"volumeAnual":"estimativa","tendencia":0,"confianca":75,"impostos":{"ii":12,"ipi":5,"pis":2.1,"cofins":9.65,"icms":18,"sec301":0,"ieepa":10,"dazio":0,"iva":22},"historico":[{"mes":"Mar/25","fobKg":0,"kgTotal":0},{"mes":"Fev/25","fobKg":0,"kgTotal":0},{"mes":"Jan/25","fobKg":0,"kgTotal":0}],"alertas":[],"licencaPrevia":false,"equivalencias":{"BR":"ncm","USA":"hts","ITA":"nc"},"fonte":"Groq/Llama"}`;
  }

  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        max_tokens: 1000,
        temperature: 0.1,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    const txt = await r.text();
    if (!r.ok) {
      console.error('Groq:', r.status, txt.slice(0,200));
      return res.status(502).json({ error: 'Groq error', status: r.status, details: txt.slice(0,200) });
    }

    const data = JSON.parse(txt);
    const content = (data.choices?.[0]?.message?.content || '').replace(/```json|```/g,'').trim();
    let parsed;
    try { parsed = JSON.parse(content); }
    catch(e) { return res.status(502).json({ error: 'JSON error', raw: content.slice(0,200) }); }
    return res.status(200).json({ ok: true, data: parsed });

  } catch(err) {
    console.error('Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
