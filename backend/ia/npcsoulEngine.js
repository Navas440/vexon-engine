// ==========================================
// NPC SOUL ENGINE — VEXON
// Motor de Alma Emocional e Memória Narrativa
// ==========================================

import db, {
  parseJson,
  toJson,
  logWorldEvent,
} from "../db/database.js";

// ==========================================
// CONFIGURAÇÃO DO OLLAMA
// ==========================================

const OLLAMA_URL   = process.env.OLLAMA_URL   || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "mistral";

async function callOllama(messages, timeout = 20000) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      signal:  controller.signal,
      body: JSON.stringify({
        model:    OLLAMA_MODEL,
        messages,
        stream:   false,
        options: { temperature: 0.9, num_predict: 300 },
      }),
    });

    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const data = await response.json();
    return data.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

// ==========================================
// MIGRAÇÃO: ADICIONA CAMPOS DE ALMA AO BANCO
// ==========================================
// Roda automaticamente uma vez. Ignora se já existir.

// SQLite não suporta "ADD COLUMN IF NOT EXISTS" — cada ALTER roda isolado
// e ignora o erro de coluna duplicada em execuções subsequentes.
function addColumnIfMissing(tabela, coluna, definicao) {
  try {
    db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao};`);
  } catch (e) {
    if (!/duplicate column name/i.test(e.message)) throw e;
  }
}

for (const tabela of ["npcs", "entidades_vivas"]) {
  addColumnIfMissing(tabela, "alma_base", "TEXT DEFAULT '{}'");
  addColumnIfMissing(tabela, "estado_emocional", "TEXT DEFAULT '{}'");
  addColumnIfMissing(tabela, "memorias_ricas", "TEXT DEFAULT '[]'");
  addColumnIfMissing(tabela, "gatilhos_evolucao", "TEXT DEFAULT '[]'");
}

// ==========================================
// TIPOS E ESTRUTURAS
// ==========================================

/**
 * Alma base — imutável após criação. Define quem o NPC é no fundo.
 * Gerada uma vez e nunca sobrescrita (apenas lida).
 */
export const ALMA_BASE_PADRAO = {
  trauma_origem:   null,    // Ex: "perdeu a família para a Eclipsa"
  medo_primitivo:  null,    // Ex: "abandono", "fracasso", "impotência"
  codigo_moral:    "neutro",// "honra", "sobrevivência", "lealdade", "prazer", "poder"
  ambicao_central: null,    // Ex: "encontrar o filho desaparecido"
  segredo_oculto:  null,    // Ex: "trabalha secretamente para a Eclipsa"
  virtude_central: null,    // Ex: "nunca abandona um aliado"
};

/**
 * Estado emocional — muda a cada interação relevante.
 */
export const ESTADO_EMOCIONAL_PADRAO = {
  // Relação com o jogador: -100 (ódio puro) a +100 (lealdade absoluta)
  relacao_jogador:  0,

  // Emoções ativas no momento (intensidade 0-10)
  emocoes: {
    medo:       0,
    raiva:      0,
    gratidao:   0,
    inveja:     0,
    esperanca:  0,
    luto:       0,
    desconfianca: 5, // padrão — NPCs começam levemente desconfiantes
    admiracao:  0,
  },

  // Última atualização emocional
  ultima_interacao: null,
  humor_geral: "neutro", // "alegre", "neutro", "sombrio", "paranóico", "desesperado"
};

/**
 * Memória rica — cada entrada é um evento narrativamente significativo.
 */
export function criarMemoriaRica(tipo, descricao, intensidade = 5, personagens = []) {
  return {
    id:          Date.now(),
    tipo,        // "trauma", "gratidao", "traicao", "promessa", "humilhacao", "cura", "perda", "alianca"
    descricao,   // Narração em 1a pessoa do NPC: "quando aquele aventureiro me salvou das chamas..."
    intensidade, // 1-10 — quanto isso pesou emocionalmente
    personagens, // Quem estava envolvido
    timestamp:   new Date().toISOString(),
    esquecida:   false, // memórias traumáticas nunca são esquecidas (intensidade > 7)
  };
}

/**
 * Gatilho de evolução — condição que, quando atingida, transforma o NPC permanentemente.
 */
export function criarGatilho(condicao, transformacao) {
  return {
    id:           Date.now(),
    condicao,     // "relacao_jogador >= 80", "foi_traido === true", "aliado_morreu"
    transformacao,// O que muda: { personalidade_nova, objetivo_novo, alinhamento_novo }
    disparado:    false,
    timestamp_disparo: null,
  };
}

// ==========================================
// FUNÇÕES DE LEITURA
// ==========================================

/**
 * Retorna a alma completa de um NPC (base + estado + memórias + gatilhos).
 */
export function getNpcSoul(npc_id, tabela = "npcs") {
  const npc = db.prepare(`SELECT * FROM ${tabela} WHERE id = ?`).get(npc_id);
  if (!npc) return null;

  return {
    id:               npc.id,
    nome:             npc.nome_unico ?? npc.nome,
    personalidade:    npc.nova_personalidade ?? npc.personalidade,
    alma_base:        parseJson(npc.alma_base,          ALMA_BASE_PADRAO),
    estado_emocional: parseJson(npc.estado_emocional,   ESTADO_EMOCIONAL_PADRAO),
    memorias_ricas:   parseJson(npc.memorias_ricas,     []),
    gatilhos_evolucao:parseJson(npc.gatilhos_evolucao,  []),
  };
}

/**
 * Retorna o estado emocional atual do NPC em relação ao jogador.
 * Inclui uma descrição textual usável diretamente no prompt do Ollama.
 */
export function getEmotionalContext(npc_id, tabela = "npcs") {
  const soul = getNpcSoul(npc_id, tabela);
  if (!soul) return null;

  const estado = soul.estado_emocional;
  const emocoes = estado.emocoes ?? {};

  // Encontra a emoção dominante
  const emocaoDominante = Object.entries(emocoes)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)[0];

  // Últimas 3 memórias relevantes (mais intensas)
  const memoriasMarcantes = (soul.memorias_ricas ?? [])
    .filter(m => !m.esquecida)
    .sort((a, b) => b.intensidade - a.intensidade)
    .slice(0, 3);

  // Nível de relação em texto
  const rel = estado.relacao_jogador ?? 0;
  const descricaoRelacao =
    rel >= 80  ? "lealdade profunda — faria quase qualquer coisa pelo jogador" :
    rel >= 50  ? "amizade genuína — confia e gosta do jogador" :
    rel >= 20  ? "simpatia cautelosa — inclinado a ajudar" :
    rel >= 0   ? "neutralidade desconfiada — observando" :
    rel >= -30 ? "ressentimento leve — guarda mágoa" :
    rel >= -60 ? "hostilidade crescente — dificilmente coopera" :
                 "ódio declarado — quer ver o jogador sofrer";

  return {
    relacao_jogador:    rel,
    descricao_relacao:  descricaoRelacao,
    humor_geral:        estado.humor_geral ?? "neutro",
    emocao_dominante:   emocaoDominante ? emocaoDominante[0] : "nenhuma",
    intensidade_emocao: emocaoDominante ? emocaoDominante[1] : 0,
    memorias_marcantes: memoriasMarcantes,
    alma_base:          soul.alma_base,

    // Texto pronto para injetar no system prompt do Ollama
    resumo_prompt: gerarResumoEmocional(soul, memoriasMarcantes, descricaoRelacao),
  };
}

/**
 * Gera um bloco de texto rico para o system prompt do Ollama.
 * Descreve quem o NPC é emocionalmente, sem expor dados crus.
 */
function gerarResumoEmocional(soul, memorias, descricaoRelacao) {
  const alma  = soul.alma_base ?? {};
  const estado = soul.estado_emocional ?? {};
  const emocoes = estado.emocoes ?? {};

  const linhas = [
    `Sua relação com o jogador: ${descricaoRelacao}.`,
    alma.trauma_origem   ? `Carrega um trauma de origem: ${alma.trauma_origem}.` : null,
    alma.medo_primitivo  ? `Seu medo mais profundo é ${alma.medo_primitivo}.` : null,
    alma.segredo_oculto  ? `Há algo que você nunca revela: ${alma.segredo_oculto}.` : null,
    alma.ambicao_central ? `Sua ambição que não te deixa dormir: ${alma.ambicao_central}.` : null,
    alma.virtude_central ? `Você nunca abre mão de: ${alma.virtude_central}.` : null,
  ];

  // Adiciona emoções ativas relevantes
  const emotivasAtivas = Object.entries(emocoes)
    .filter(([, v]) => v >= 4)
    .map(([k, v]) => `${k} (${v}/10)`);

  if (emotivasAtivas.length > 0) {
    linhas.push(`Emoções que você sente agora: ${emotivasAtivas.join(", ")}.`);
  }

  // Adiciona memórias marcantes como flashbacks internos
  for (const mem of memorias) {
    if (mem.intensidade >= 6) {
      linhas.push(`Você lembra vividamente: ${mem.descricao}`);
    }
  }

  if (estado.humor_geral && estado.humor_geral !== "neutro") {
    linhas.push(`Hoje você está de humor ${estado.humor_geral}.`);
  }

  return linhas.filter(Boolean).join("\n");
}

// ==========================================
// FUNÇÕES DE ATUALIZAÇÃO EMOCIONAL
// ==========================================

/**
 * Atualiza o estado emocional de um NPC após uma interação.
 * Recebe os deltas de cada emoção e o delta de relação com o jogador.
 *
 * @param {number} npc_id
 * @param {object} deltas  - { relacao_jogador: +10, emocoes: { gratidao: +3, medo: -1 } }
 * @param {string} tabela
 */
export function updateEmotionalState(npc_id, deltas, tabela = "npcs") {
  const npc = db.prepare(`SELECT estado_emocional FROM ${tabela} WHERE id = ?`).get(npc_id);
  if (!npc) return null;

  const estado = parseJson(npc.estado_emocional, ESTADO_EMOCIONAL_PADRAO);

  // Atualiza relação com o jogador (clamped -100 a +100)
  if (deltas.relacao_jogador !== undefined) {
    estado.relacao_jogador = Math.max(-100, Math.min(100,
      (estado.relacao_jogador ?? 0) + deltas.relacao_jogador
    ));
  }

  // Atualiza emoções individuais (clamped 0 a 10)
  if (deltas.emocoes) {
    estado.emocoes = estado.emocoes ?? {};
    for (const [emocao, delta] of Object.entries(deltas.emocoes)) {
      estado.emocoes[emocao] = Math.max(0, Math.min(10,
        (estado.emocoes[emocao] ?? 0) + delta
      ));
    }
  }

  // Atualiza humor geral se fornecido
  if (deltas.humor_geral) {
    estado.humor_geral = deltas.humor_geral;
  }

  estado.ultima_interacao = new Date().toISOString();

  // Recalcula humor geral automaticamente se não fornecido explicitamente
  if (!deltas.humor_geral) {
    estado.humor_geral = calcularHumorGeral(estado);
  }

  db.prepare(`
    UPDATE ${tabela}
    SET estado_emocional = ?, atualizado_em = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(toJson(estado), npc_id);

  return estado;
}

/**
 * Calcula o humor geral automaticamente baseado nas emoções ativas.
 */
function calcularHumorGeral(estado) {
  const e = estado.emocoes ?? {};
  const rel = estado.relacao_jogador ?? 0;

  if (e.luto >= 7 || e.desespero >= 7)         return "desesperado";
  if (e.medo >= 6)                               return "paranóico";
  if (e.raiva >= 7)                              return "hostil";
  if (e.gratidao >= 6 || rel >= 60)              return "alegre";
  if (e.esperanca >= 5)                          return "otimista";
  if (e.inveja >= 5 || e.desconfianca >= 7)      return "sombrio";
  return "neutro";
}

/**
 * Adiciona uma memória rica ao NPC e persiste no banco.
 */
export function addRichMemory(npc_id, memoria, tabela = "npcs") {
  const npc = db.prepare(`SELECT memorias_ricas FROM ${tabela} WHERE id = ?`).get(npc_id);
  if (!npc) return null;

  const memorias = parseJson(npc.memorias_ricas, []);

  // Memórias de alta intensidade nunca são descartadas
  const novaMemoria = {
    ...memoria,
    esquecida: memoria.intensidade <= 3 && memorias.length > 20,
  };

  memorias.push(novaMemoria);

  // Mantém no máximo 30 memórias — esquece as mais antigas e menos intensas
  const memoriasFiltradas = memorias
    .sort((a, b) => {
      if (b.intensidade !== a.intensidade) return b.intensidade - a.intensidade;
      return new Date(b.timestamp) - new Date(a.timestamp);
    })
    .slice(0, 30);

  db.prepare(`
    UPDATE ${tabela}
    SET memorias_ricas = ?, atualizado_em = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(toJson(memoriasFiltradas), npc_id);

  logWorldEvent(
    "memoria_npc",
    `${tabela === "npcs" ? "NPC" : "Entidade"} ${npc_id} formou memória: ${memoria.descricao.slice(0, 60)}`,
    [npc_id]
  );

  return novaMemoria;
}

// ==========================================
// SISTEMA DE GATILHOS DE EVOLUÇÃO
// ==========================================

/**
 * Verifica e dispara gatilhos de evolução baseado no estado emocional atual.
 * Retorna os gatilhos que foram disparados nesta verificação.
 */
export function checkEvolutionTriggers(npc_id, tabela = "npcs") {
  const soul = getNpcSoul(npc_id, tabela);
  if (!soul) return [];

  const estado     = soul.estado_emocional ?? {};
  const gatilhos   = soul.gatilhos_evolucao ?? [];
  const disparados = [];

  for (const gatilho of gatilhos) {
    if (gatilho.disparado) continue;

    const ativado = avaliarCondicao(gatilho.condicao, estado);
    if (!ativado) continue;

    // Marca como disparado
    gatilho.disparado        = true;
    gatilho.timestamp_disparo = new Date().toISOString();
    disparados.push(gatilho);

    // Aplica a transformação
    aplicarTransformacao(npc_id, gatilho.transformacao, tabela);

    logWorldEvent(
      "evolucao_npc",
      `NPC ${npc_id} evoluiu: gatilho "${gatilho.condicao}" disparado.`,
      [npc_id]
    );
  }

  if (disparados.length > 0) {
    db.prepare(`
      UPDATE ${tabela}
      SET gatilhos_evolucao = ?, atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(toJson(gatilhos), npc_id);
  }

  return disparados;
}

/**
 * Avalia uma condição de gatilho contra o estado emocional atual.
 * Suporta: "relacao_jogador >= 80", "emocoes.medo >= 8", "humor_geral === paranóico"
 */
function avaliarCondicao(condicao, estado) {
  try {
    // Substitui referências ao estado pelos valores reais
    const expr = condicao
      .replace(/relacao_jogador/g, String(estado.relacao_jogador ?? 0))
      .replace(/humor_geral\s*===\s*["'](\w+)["']/g, (_, val) =>
        String(estado.humor_geral === val))
      .replace(/emocoes\.(\w+)/g, (_, emocao) =>
        String(estado.emocoes?.[emocao] ?? 0));

    // Avalia expressão simples (sem eval — apenas comparações numéricas)
    const match = expr.match(/^(-?\d+)\s*(>=|<=|>|<|===|==|!==|!=)\s*(-?\d+)$/);
    if (!match) return false;

    const [, a, op, b] = match;
    const na = Number(a), nb = Number(b);
    switch (op) {
      case ">":  return na > nb;
      case ">=": return na >= nb;
      case "<":  return na < nb;
      case "<=": return na <= nb;
      case "===":
      case "==": return na === nb;
      case "!==":
      case "!=": return na !== nb;
    }
  } catch { /* ignora erros de avaliação */ }
  return false;
}

/**
 * Aplica as transformações de uma evolução de NPC no banco.
 */
function aplicarTransformacao(npc_id, transformacao, tabela) {
  if (!transformacao) return;

  const updates = [];
  const params  = [];

  if (transformacao.personalidade_nova) {
    updates.push("nova_personalidade = ?");
    params.push(transformacao.personalidade_nova);
  }
  if (transformacao.objetivo_novo) {
    updates.push("objetivo = ?");
    params.push(transformacao.objetivo_novo);
  }
  if (transformacao.alinhamento_novo) {
    updates.push("alinhamento = ?");
    params.push(transformacao.alinhamento_novo);
  }
  if (transformacao.relacao_nova !== undefined) {
    updates.push("relacao_com_jogador = ?");
    params.push(transformacao.relacao_nova);
  }

  if (updates.length === 0) return;

  updates.push("atualizado_em = CURRENT_TIMESTAMP");
  params.push(npc_id);

  db.prepare(`UPDATE ${tabela} SET ${updates.join(", ")} WHERE id = ?`).run(...params);
}

// ==========================================
// PROCESSADOR DE RESPOSTA DA IA
// ==========================================

/**
 * Recebe a resposta do Ollama de um diálogo e extrai os deltas emocionais.
 * O Ollama retorna `deltas_emocionais` no JSON de diálogo — isso processa e persiste.
 *
 * @param {number} npc_id
 * @param {object} respostaIA    - Objeto retornado pelo dialogueEngine
 * @param {string} falaJogador   - O que o jogador disse
 * @param {string} tabela
 */
export function processDialogueEmotions(npc_id, respostaIA, falaJogador, tabela = "npcs") {
  const deltas = respostaIA.deltas_emocionais;
  if (!deltas) return null;

  // Aplica os deltas emocionais
  const novoEstado = updateEmotionalState(npc_id, deltas, tabela);

  // Cria memória rica se o evento foi significativo (intensidade >= 5)
  if (deltas.intensidade_memoria >= 5) {
    addRichMemory(npc_id, criarMemoriaRica(
      deltas.tipo_memoria ?? "interacao",
      deltas.descricao_memoria ?? falaJogador,
      deltas.intensidade_memoria,
      ["jogador"]
    ), tabela);
  }

  // Verifica gatilhos de evolução
  const gatilhosDisparados = checkEvolutionTriggers(npc_id, tabela);

  return {
    estado_atualizado:   novoEstado,
    gatilhos_disparados: gatilhosDisparados,
  };
}

// ==========================================
// INICIALIZADOR DE ALMA
// ==========================================

/**
 * Inicializa a alma de um NPC existente no banco.
 * Usa o Ollama para gerar trauma, medos e ambições baseados na personalidade.
 *
 * @param {number} npc_id
 * @param {string} tabela
 * @param {boolean} usar_ia - Se true, gera com Ollama; false usa valores padrão
 */
export async function initializeNpcSoul(npc_id, tabela = "npcs", usar_ia = true) {
  const npc = db.prepare(`SELECT * FROM ${tabela} WHERE id = ?`).get(npc_id);
  if (!npc) throw new Error(`NPC ${npc_id} não encontrado.`);

  // Não reinicializa se já tem alma
  const almaExistente = parseJson(npc.alma_base, null);
  if (almaExistente && almaExistente.codigo_moral) {
    return almaExistente;
  }

  let alma = { ...ALMA_BASE_PADRAO };

  if (usar_ia) {
    try {
      const raw = await callOllama([
        {
          role: "system",
          content: `Você cria almas psicológicas profundas para personagens de RPG.
Responda APENAS com JSON válido. Sem texto antes ou depois.`,
        },
        {
          role: "user",
          content: `Crie a alma psicológica de ${npc.nome}:
Personalidade: ${npc.personalidade || npc.nova_personalidade || "desconhecida"}
Arquétipo: ${npc.arquetipo || "desconhecido"}
Alinhamento: ${npc.alinhamento || "neutro"}
Objetivo: ${npc.objetivo || "sobreviver"}
Descrição: ${npc.descricao || ""}

JSON com estes campos (todos obrigatórios):
{
  "trauma_origem":   "uma frase sobre o evento formativo mais doloroso",
  "medo_primitivo":  "o medo mais profundo em uma palavra ou curta frase",
  "codigo_moral":    "sobrevivência|honra|lealdade|prazer|poder|amor",
  "ambicao_central": "o que ele mais quer na vida em uma frase",
  "segredo_oculto":  "algo que nunca conta a ninguém (ou null se não houver)",
  "virtude_central": "algo que nunca abandona mesmo sob pressão"
}`,
        },
      ]);

      const match = raw.replace(/```json/gi, "").replace(/```/g, "").match(/\{[\s\S]*?\}/);
      if (match) alma = { ...ALMA_BASE_PADRAO, ...JSON.parse(match[0]) };
    } catch (err) {
      console.warn(`[Soul] Ollama falhou para NPC ${npc_id}: ${err.message}. Usando padrão.`);
    }
  }

  // Gatilhos padrão baseados no alinhamento
  const gatilhosPadrao = gerarGatilhosPadrao(npc.alinhamento, npc.objetivo);

  db.prepare(`
    UPDATE ${tabela}
    SET
      alma_base          = ?,
      estado_emocional   = ?,
      memorias_ricas     = ?,
      gatilhos_evolucao  = ?,
      atualizado_em      = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    toJson(alma),
    toJson({ ...ESTADO_EMOCIONAL_PADRAO }),
    toJson([]),
    toJson(gatilhosPadrao),
    npc_id
  );

  logWorldEvent("alma_criada", `Alma de "${npc.nome}" inicializada.`, [npc_id]);
  return alma;
}

/**
 * Gera gatilhos de evolução padrão baseados no alinhamento do NPC.
 */
function gerarGatilhosPadrao(alinhamento = "neutro", objetivo = "") {
  const gatilhos = [
    // Gatilho universal: traição
    criarGatilho(
      "relacao_jogador <= -60",
      {
        personalidade_nova: "Ressentido e vingativo. Nunca esquece uma traição.",
        objetivo_novo:      `Prejudicar o jogador sempre que possível. ${objetivo}`,
      }
    ),
    // Gatilho universal: lealdade profunda
    criarGatilho(
      "relacao_jogador >= 85",
      {
        personalidade_nova: "Devoto e protetor. Colocaria a vida em risco pelo jogador.",
        alinhamento_novo:   alinhamento?.includes("mau") ? "neutro" : alinhamento,
      }
    ),
    // Gatilho de medo extremo
    criarGatilho(
      "emocoes.medo >= 9",
      {
        personalidade_nova: "Quebrado pelo medo. Age de forma imprevisível e errática.",
        humor_geral:        "desesperado",
      }
    ),
  ];

  return gatilhos;
}