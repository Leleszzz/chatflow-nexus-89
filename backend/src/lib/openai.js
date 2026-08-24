// Cliente HTTP da OpenAI compartilhado. Vive aqui (e não em routes/agents.js)
// porque a transcrição também precisa dele — para separar falantes e para o
// resumo clínico — e duplicar o tratamento de erro em dois lugares só garante
// que um dos dois vai ficar para trás.
export async function callOpenAI({ apiKey, model, temperature, messages, tools, tool_choice, response_format }) {
  const body = { model, temperature, messages };
  if (tools) body.tools = tools;
  if (tool_choice) body.tool_choice = tool_choice;
  if (response_format) body.response_format = response_format;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    let detail = text;
    try {
      detail = JSON.parse(text)?.error?.message || text;
    } catch {}
    const err = new Error(`OpenAI ${response.status}: ${detail}`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}
