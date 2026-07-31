import "dotenv/config";
import { handleEntityCreation } from "./entityHandler.js";
import { getOrCreateActiveSession, addMessageToSession } from "./db/database.js";
import { TOM_VEXON } from "./loreVexon.js";

// ==========================================
// CLIENTE OLLAMA — VEXON
// ==========================================
// Módulo fino de acesso ao Ollama, usado pelo server.js para:
//   - checkOllamaHealth() — health check do modelo local
//   - askMaster()         — narração avulsa (sem criação de entidade)
//   - sendToLLM()         — chat livre com possível tool-use de criação
//                           de entidade, seguindo docs/contracts.md

const OLLAMA_URL   = process.env.OLLAMA_URL   || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "mistral";

const HEALTH_TIMEOUT = 5_000;
const CHAT_TIMEOUT   = 30_000;

const SISTEMA_MESTRE = `${TOM_VEXON}
Você é o Mestre Supremo de Vexon. Narre com atmosfera e tensão, em português, em parágrafos curtos e imersivos.
Nunca mencione mecânicas de jogo, JSON ou números — apenas narrativa.`;

const SISTEMA_CRIACAO = `${TOM_VEXON}
Você é o Mestre Supremo de Vexon.
Se o jogador pedir a criação de um NPC, item ou monstro, responda APENAS com um JSON válido,
sem nenhum texto antes ou depois, em um dos formatos abaixo:

{"action":"create_npc","data":{"nome":"...","alinhamento":"...","nivel_social":"...","arquetipo":"...","personalidade":"...","descricao":"...","habilidade_tematica":"...","classe":"..."}}
{"action":"create_item","data":{"nome":"...","raridade":"...","tipo":"...","descricao":"...","habilidade_tematica":"...","efeito":{"tipo":"...","intensidade":"...","alvo":"..."}}}
{"action":"create_monster","data":{"nome":"...","ameaca":"...","tipo":"...","descricao":"...","habilidade_tematica":"...","classe":"..."}}

O campo "classe" é OPCIONAL em create_npc/create_monster — só inclua quando o NPC/monstro for
narrativamente relevante em combate (não para todo comerciante, civil ou criatura comum). Se
incluído, use exatamente um destes 12 ids: herdeiro_tatico, anomalia_bioenergetica,
ilusionista_das_sombras, arconte, tecno_mago, hacker_corporativo, algoz_cibernetico,
bastiao_implacavel, herdeiro_do_mar, herdeiro_de_pedra, desperto_vex, predador_estelar.
Omita o campo ou use null se a entidade não precisar de uma classe de combate.

Nunca defina HP, ataque, defesa ou qualquer valor numérico final — isso é responsabilidade exclusiva do backend.

Se o pedido do jogador NÃO for para criar uma entidade, responda apenas com:
{"action":"narrate","data":{"texto":"sua narração aqui"}}`;

// ==========================================
// HELPERS
// ==========================================

async function callOllama(messages, { timeout = CHAT_TIMEOUT, ...options } = {}) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeout);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      signal:  controller.signal,
      body: JSON.stringify({
        model:    OLLAMA_MODEL,
        messages,
        stream:   false,
        options: {
          temperature: 0.85,
          top_p:       0.92,
          num_predict: 400,
          ...options,
        },
      }),
    });

    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    return data.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extrai JSON seguro de uma resposta do Ollama.
 * Retorna null se não houver JSON válido (ex.: resposta puramente narrativa).
 */
function extrairJson(texto) {
  const limpo = texto.replace(/```json/gi, "").replace(/```/g, "");
  const match = limpo.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// ==========================================
// HEALTH CHECK
// ==========================================

export async function checkOllamaHealth() {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), HEALTH_TIMEOUT);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);

    const data    = await res.json();
    const modelos = (data.models ?? []).map(m => m.name);
    const disponivel = modelos.some(
      m => m === OLLAMA_MODEL || m.startsWith(`${OLLAMA_MODEL}:`)
    );

    return {
      online:             true,
      modelo:             OLLAMA_MODEL,
      modelo_disponivel:  disponivel,
      modelos_instalados: modelos,
      erro:               null,
    };
  } catch (e) {
    return {
      online:             false,
      modelo:             OLLAMA_MODEL,
      modelo_disponivel:  false,
      modelos_instalados: [],
      erro:               e.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ==========================================
// NARRAÇÃO AVULSA
// ==========================================

export async function askMaster(prompt, options = {}) {
  const messages = [
    { role: "system", content: SISTEMA_MESTRE },
    { role: "user",   content: prompt },
  ];

  const resposta = await callOllama(messages, options);
  return resposta.trim();
}

// ==========================================
// CHAT LIVRE COM TOOL-USE DE CRIAÇÃO
// ==========================================

/**
 * Envia uma mensagem livre ao Mestre. Se a resposta for um tool-use
 * de criação (create_npc | create_item | create_monster), a entidade
 * é validada e persistida via entityHandler.js, conforme docs/contracts.md.
 *
 * @param {string} message
 * @param {number|null} jogadorId
 * @param {object} context - { player: { nivel } }
 */
export async function sendToLLM(message, jogadorId = null, context = {}) {
  const nivelJogador = context.player?.nivel ?? 1;
  const sessao       = jogadorId ? getOrCreateActiveSession(jogadorId) : null;
  const historico    = sessao?.mensagens ?? [];

  const messages = [
    { role: "system", content: SISTEMA_CRIACAO },
    ...historico.slice(-10),
    { role: "user", content: message },
  ];

  const resposta = await callOllama(messages);

  if (sessao) {
    addMessageToSession(sessao.id, "user", message);
    addMessageToSession(sessao.id, "assistant", resposta);
  }

  const json = extrairJson(resposta);
  const semTool = {
    narrativa:       resposta.trim() || "O Mestre observa em silêncio...",
    tool_executada:  false,
    entidade_criada: null,
    sessao_id:       sessao?.id ?? null,
  };

  if (!json || !json.action) return semTool;

  const TIPO_POR_ACAO = {
    create_npc:     "npc",
    create_item:    "item",
    create_monster: "monstro",
  };

  const tipoEntidade = TIPO_POR_ACAO[json.action];
  if (!tipoEntidade) {
    return { ...semTool, narrativa: json.data?.texto ?? semTool.narrativa };
  }

  const entidade = await handleEntityCreation(
    { ...json.data, tipo_entidade: tipoEntidade },
    nivelJogador,
    true
  );

  return {
    narrativa:       `${entidade.nome} foi trazido à existência em Vexon.`,
    tool_executada:  true,
    entidade_criada: entidade,
    sessao_id:       sessao?.id ?? null,
  };
}
