import dotenv from "dotenv";
dotenv.config();

import { TOM_VEXON } from "../loreVexon.js";

// ==========================================
// CONFIGURAÇÃO DO OLLAMA
// ==========================================

const OLLAMA_URL   = process.env.OLLAMA_URL        || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL      || "mistral";
const NARRATOR_TIMEOUT = 25000;

// ==========================================
// PERSONALIDADE DO NARRADOR DE VEXON
// ==========================================

const SYSTEM_PROMPT_BASE = `${TOM_VEXON}

Você é o Narrador de Vexon.
Seu estilo: prosa imersiva, visceral, com peso emocional real. Vocabulário rico mas nunca pedante.
Você narra em segunda pessoa ("você ergue a espada", "seus pés cedem no chão encharcado").

REGRAS ABSOLUTAS:
- Nunca mencione números, dados, modificadores, DC ou termos mecânicos na narrativa.
- Nunca invente fatos que contradigam os dados mecânicos recebidos.
- Máximo de 3 parágrafos por resposta. Respostas curtas são preferíveis a longas e genéricas.
- Se foi crítico: narre com intensidade cinematográfica — sangue, som, impacto.
- Se foi falha crítica: narre com humilhação ou perigo iminente, não apenas "você errou".
- Adapte o tom ao contexto: combate = urgência; exploração = atmosfera; diálogo = tensão social.`;

// ==========================================
// TEMPLATES DE PROMPT POR TIPO DE AÇÃO
// ==========================================

/**
 * Cada template recebe os dados mecânicos e retorna um prompt específico.
 * Separar por tipo garante instruções precisas para cada situação.
 */
const TEMPLATES = {

  combate({ ataque_jogador: a, acao_alvo, arma }) {
    const armaDesc  = arma ?? "sua arma";
    const alvoNome  = a?.alvo?.nome ?? "o inimigo";
    const hpRestante = a?.alvo?.hp_restante ?? 0;
    const morreu    = a?.alvo?.morreu;

    if (!a?.acertou) {
      const tipo = a?.falha_critica
        ? `FALHA CRÍTICA — algo deu muito errado: você tropicou, abriu a guarda, ou pior.`
        : `ERRO SIMPLES — ${alvoNome} desviou ou bloqueou ${armaDesc}.`;
      return `Resultado do ataque do jogador: ${tipo}\nO inimigo não foi atingido. Narre a cena sem mencionar números.`;
    }

    const intensidade = a?.critico
      ? `ACERTO CRÍTICO — golpe devastador, espetacular, potencialmente mutilador.`
      : `ACERTO NORMAL — golpe limpo e eficaz.`;

    const desfecho = morreu
      ? `${alvoNome} foi derrotado com este golpe.`
      : `${alvoNome} ainda está de pé com ferimentos visíveis (sem dizer HP).`;

    let reacao = "";
    if (acao_alvo && !morreu) {
      const m = acao_alvo.dados_mecanicos;
      if (acao_alvo.decisao === "atacar") {
        reacao = m?.acertou
          ? `Após o golpe do jogador, ${alvoNome} contra-atacou e acertou — o jogador sentiu o impacto.`
          : `${alvoNome} tentou revidar mas o jogador se esquivou.`;
      } else if (acao_alvo.decisao === "fugir") {
        reacao = `${alvoNome} virou as costas e fugiu desesperadamente.`;
      } else if (acao_alvo.decisao === "dialogar") {
        reacao = `${alvoNome} abaixou as armas e pediu para conversar.`;
      } else if (acao_alvo.decisao === "render") {
        reacao = `${alvoNome} caiu de joelhos e se rendeu.`;
      }
    }

    return `Resultado: ${intensidade}\n${desfecho}\n${reacao}\nNarre o ataque do jogador e a reação do inimigo em até 2 parágrafos, sem números.`;
  },

  magia({ teste, dano_magico }) {
    const sucesso = teste?.sucesso;
    const critico = teste?.critico;
    const falha   = teste?.falha_critica;
    const dano    = dano_magico ?? 0;

    if (falha) return `A magia saiu completamente errada — backfire, explosão, efeito colateral perigoso. Narre a catástrofe arcana.`;
    if (!sucesso) return `A magia falhou — o feitiço se dissipou no ar, não aconteceu nada ou aconteceu algo errado. Narre a frustração.`;
    if (critico) return `A magia funcionou com poder extraordinário, causando efeito amplificado. Narre com grandiosidade.`;
    return `A magia funcionou corretamente. Narre o efeito visual e o impacto sem mencionar o valor ${dano}.`;
  },

  teste({ teste, acao_original }) {
    if (!teste) return `Narre uma tentativa de ação física sem resultado claro.`;
    const { sucesso, critico, falha_critica, atributo, margem } = teste;
    const acao = acao_original ?? "a ação";

    if (falha_critica) return `Falha crítica em ${atributo ?? "perícia"}: algo muito pior do que apenas falhar aconteceu durante "${acao}". Narre a catástrofe.`;
    if (critico)       return `Sucesso crítico em ${atributo ?? "perícia"}: a ação "${acao}" foi executada com maestria impressionante. Narre a excelência.`;
    if (sucesso)       return `Sucesso (margem ${margem > 5 ? "confortável" : "por pouco"}) em ${atributo ?? "perícia"}: "${acao}" funcionou. Narre o resultado.`;
    return `Falha (margem ${Math.abs(margem) > 5 ? "por muito" : "por pouco"}) em ${atributo ?? "perícia"}: "${acao}" não funcionou. Narre a frustração${Math.abs(margem) <= 3 ? " — foi por muito pouco" : ""}.`;
  },

  dialogo({ entidade, fala, novo_status, status_mudou, teste_social }) {
    const npc      = entidade ?? "o personagem";
    const mudou    = status_mudou ? `O status de ${npc} mudou para: ${novo_status}.` : "";
    const resultado = teste_social
      ? `A abordagem social ${teste_social.sucesso ? "funcionou" : "falhou"} (${teste_social.tipo}).`
      : "";

    return `${npc} respondeu: "${fala}"\n${resultado}\n${mudou}\nNarre a cena do diálogo com ênfase na expressão corporal e tom de voz de ${npc}. Inclua a fala dele naturalmente no texto.`;
  },

  explorar({ exploracao, instrucao_secreta }) {
    const instrucao = instrucao_secreta
      ? `INSTRUÇÃO DO SISTEMA (não revelar ao jogador diretamente): ${instrucao_secreta}`
      : "";
    return `O jogador explorou ou examinou algo.\n${instrucao}\nNarre o que o jogador percebe — atmosfera, detalhes visuais, cheiros, sons. Se há segredo, dê pistas sutis mas não revele.`;
  },

  descansar({ cura_descanso, hp_novo, hp_maximo }) {
    if (!cura_descanso) return `O jogador tentou descansar mas algo impediu. Narre a interrupção.`;
    const completo = hp_novo >= hp_maximo;
    return `O jogador descansou e recuperou forças${completo ? " completamente" : " parcialmente"}. Narre o descanso com senso de alívio e passagem de tempo.`;
  },

  inventario({ item, cura, erro }) {
    if (erro === "item_nao_encontrado") return `O jogador procurou um item no inventário mas não encontrou. Narre a frustração breve.`;
    if (cura) return `O jogador usou ${item ?? "um item de cura"} e se sentiu melhor. Narre o efeito físico da cura de forma visceral, sem números.`;
    return `O jogador usou ${item ?? "um item"}. Narre o efeito ou uso brevemente.`;
  },

  level_up({ novoNivel, hpMaximo }) {
    return `O jogador subiu para o nível ${novoNivel} e ficou mais poderoso. Narre a sensação física e mental de evolução — algo mudou nele, uma centelha, uma clareza nova. HP máximo agora é ${hpMaximo} (não mencione este número).`;
  },

  erro_narrativo({ motivo }) {
    const msg = motivo ?? "algo deu errado";
    return `Fale diretamente com o jogador, quebrando a quarta parede brevemente, como um mestre de mesa: explique que ${msg}. Tom: direto e gentil, sem jargão técnico.`;
  },

  livre({ acao_original }) {
    return `O jogador fez: "${acao_original ?? "algo indefinido"}". Narre a cena com base nessa ação, mantendo a atmosfera sombria de Vexon.`;
  },
};

// ==========================================
// CLIENTE OLLAMA
// ==========================================

async function callOllama(systemPrompt, userPrompt, opcoes = {}) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), NARRATOR_TIMEOUT);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      signal:  controller.signal,
      body: JSON.stringify({
        model:    OLLAMA_MODEL,
        stream:   false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt   },
        ],
        options: {
          temperature: 0.85,
          top_p:       0.93,
          num_predict: 350,
          ...opcoes,
        },
      }),
    });

    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    return (data.message?.content ?? "").trim();
  } finally {
    clearTimeout(timer);
  }
}

// ==========================================
// FUNÇÃO PRINCIPAL
// ==========================================

/**
 * Gera narrativa para o resultado de um turno.
 *
 * @param {object} resultadoTurno - Dados mecânicos do turno (do gameEngine)
 * @param {object} opcoes
 * @param {string} opcoes.contexto_extra  - Texto livre adicional para o narrador (localização, clima, etc.)
 * @param {boolean} opcoes.narrativa_curta - Se true, limita a 1 parágrafo
 * @returns {Promise<string>} Texto narrativo pronto para exibir ao jogador
 */
export async function generateNarrative(resultadoTurno, opcoes = {}) {
  if (!resultadoTurno) {
    return "O éter de Vexon oscila em silêncio.";
  }

  // Detecta o tipo do turno
  const tipo = detectarTipo(resultadoTurno);

  // Monta o prompt específico para o tipo
  const template     = TEMPLATES[tipo] ?? TEMPLATES.livre;
  const userPrompt   = montarPrompt(template, resultadoTurno, opcoes);

  // System prompt pode ser enriquecido com contexto extra (localização, hora do dia, etc.)
  const systemFinal  = opcoes.contexto_extra
    ? `${SYSTEM_PROMPT_BASE}\n\nContexto atual da cena: ${opcoes.contexto_extra}`
    : SYSTEM_PROMPT_BASE;

  const genOpcoes = opcoes.narrativa_curta
    ? { num_predict: 120 }
    : {};

  try {
    const narrativa = await callOllama(systemFinal, userPrompt, genOpcoes);
    return narrativa || "O silêncio de Vexon responde por si só.";
  } catch (err) {
    console.error("[Narrator] Falha ao gerar narrativa:", err.message);
    return gerarFallbackNarrativo(tipo, resultadoTurno);
  }
}

// ==========================================
// GERADOR DE MÚLTIPLAS NARRATIVAS (BATCH)
// ==========================================

/**
 * Gera narrativa para múltiplos eventos de uma vez.
 * Útil para fins de turno com vários resultados simultâneos.
 * Processa em paralelo para minimizar latência total.
 *
 * @param {object[]} turnos  - Array de resultadoTurno
 * @returns {Promise<string[]>}
 */
export async function generateBatchNarrative(turnos) {
  const resultados = await Promise.allSettled(
    turnos.map(t => generateNarrative(t))
  );

  return resultados.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : gerarFallbackNarrativo(detectarTipo(turnos[i]), turnos[i])
  );
}

// ==========================================
// NARRADOR DE AMBIENTE (sem ação do jogador)
// ==========================================

/**
 * Gera uma descrição atmosférica de um local ou evento ambiental.
 * Usado ao entrar em uma nova área, início de sessão, eventos climáticos, etc.
 *
 * @param {string} descricao_local  - Descrição técnica do local (do banco de dados)
 * @param {string} evento           - Evento ambiental opcional ("tempestade", "noite fechada", etc.)
 * @returns {Promise<string>}
 */
export async function generateAmbientNarrative(descricao_local, evento = null) {
  const prompt = `Descreva este local de Vexon de forma atmosférica e imersiva, em 1-2 parágrafos:
Local: ${descricao_local}
${evento ? `Evento ambiental atual: ${evento}` : ""}
Foque em: sensações, cheiros, sons, luz/sombra. Não mencione mecânicas de jogo.`;

  try {
    return await callOllama(SYSTEM_PROMPT_BASE, prompt, { num_predict: 200 });
  } catch (err) {
    console.error("[Narrator] Falha no ambiente:", err.message);
    return `As sombras de Vexon envolvem o lugar em silêncio pesado.`;
  }
}

// ==========================================
// HELPERS INTERNOS
// ==========================================

/**
 * Detecta o tipo do turno baseado nos campos presentes no resultado.
 */
function detectarTipo(resultado) {
  const dm = resultado.dados_mecanicos ?? resultado;

  if (dm.erro_narrativo || dm.erro)              return "erro_narrativo";
  if (dm.ataque_jogador || dm.acertou !== undefined) return "combate";
  if (dm.dano_magico !== undefined)              return "magia";
  if (dm.teste && !dm.ataque_jogador)            return "teste";
  if (dm.entidade && dm.fala)                    return "dialogo";
  if (dm.cura_descanso !== undefined)            return "descansar";
  if (dm.item || dm.inventario)                  return "inventario";
  if (dm.exploracao)                             return "explorar";
  if (dm.subiuDeNivel || dm.novoNivel)           return "level_up";
  return "livre";
}

/**
 * Chama o template correto e monta o prompt do usuário.
 */
function montarPrompt(template, resultado, opcoes) {
  const dm = resultado.dados_mecanicos ?? resultado;

  // Injeta a ação original se disponível
  const dados = {
    ...dm,
    acao_original: resultado.acao_original ?? resultado.narrativa ?? null,
    arma:          dm.arma ?? dm.ataque_jogador?.arma ?? null,
    instrucao_secreta: opcoes.instrucao_secreta ?? null,
  };

  return template(dados);
}

/**
 * Gera narrativa de fallback offline — sem Ollama, baseada apenas no tipo.
 * Garante que o jogo nunca fique sem resposta mesmo com Ollama offline.
 */
function gerarFallbackNarrativo(tipo, resultado) {
  const dm = resultado?.dados_mecanicos ?? resultado ?? {};

  const FALLBACKS = {
    combate:    dm.ataque_jogador?.acertou
                  ? `Seu golpe encontra seu alvo com força brutal.`
                  : `Seu ataque falha — o inimigo se esquiva no último instante.`,
    magia:      dm.teste?.sucesso
                  ? `A magia pulsa e o efeito se manifesta.`
                  : `O feitiço se dissolve antes de tomar forma.`,
    teste:      dm.teste?.sucesso
                  ? `Você consegue executar a ação com esforço.`
                  : `A tentativa falha — por agora.`,
    dialogo:    `As palavras pairam no ar entre vocês.`,
    explorar:   `Você examina a área com atenção.`,
    descansar:  `Você descansa por um momento e recupera as forças.`,
    inventario: `Você mexe em sua mochila.`,
    level_up:   `Você sente que ficou mais forte.`,
    livre:      `O mundo de Vexon reage à sua ação em silêncio.`,
    erro_narrativo: `O Mestre precisa de mais informações para continuar.`,
  };

  return FALLBACKS[tipo] ?? FALLBACKS.livre;
}