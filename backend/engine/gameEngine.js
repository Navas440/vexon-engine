import db, {
  getPlayer,
  getActiveEntityByName,
  getPlayerInventory,
  getActiveEnemies,
  consumeItem,
  updatePlayerHP,
  updatePlayerStatus,
  insertMonster,
  spawnEntity,
  logWorldEvent,
  getOrCreateActiveSession,
  addMessageToSession,
  getWorldSnapshot,
} from "../db/database.js";
import { calculateAttack, processCombatRound } from "./combatEngine.js";
import { rollD20Test }                          from "./skillEngine.js";
import { processEntityTurn }                    from "./entityTurn.js";
import { rollDice }                             from "./diceEngine.js";
import { getLojas, getEstoqueLoja, comprarItem, venderItem } from "./economyEngine.js";
import { iniciarViagem, getLocaisConectados, getLocaisAtivos, getPosicaoJogador } from "./locationEngine.js";
import { getFaccaoPorNome, modificarReputacao } from "./factionEngine.js";
import { getWorldContextForPrompt, deltaWorldState, registrarEventoMundo } from "../ia/worldEngine.js";
import { TOM_VEXON, REGRA_SELO } from "../loreVexon.js";
import { descansoCurto, descansoLongo } from "./restEngine.js";
import { classificarComOllama, resolverManobra } from "../ia/intentClassifier.js";
import { rollDeathSave, estabilizarAliado } from "./deathEngine.js";

// ==========================================
// CONFIGURAÇÃO DO OLLAMA
// ==========================================

const OLLAMA_URL   = process.env.OLLAMA_URL   || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "mistral";

// Timeout para chamadas narrativas (podem ser mais longas que decisões de combate)
const NARRATIVE_TIMEOUT = 30000;
const INTENT_TIMEOUT    = 10000;

// ==========================================
// CLIENTE OLLAMA UNIFICADO
// ==========================================

/**
 * Chama o Ollama com um array de mensagens.
 * @param {object[]} messages   - [{ role, content }]
 * @param {number}   timeout    - ms antes de abortar
 * @param {object}   options    - opções extras de geração
 */
async function callOllama(messages, timeout = NARRATIVE_TIMEOUT, options = {}) {
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
 * Modelos locais frequentemente adicionam texto em volta do JSON.
 */
function extrairJson(texto) {
  const match = texto.replace(/```json/gi, "").replace(/```/g, "").match(/\{[\s\S]*?\}/);
  if (!match) throw new Error("Nenhum JSON encontrado na resposta da IA.");
  return JSON.parse(match[0]);
}

// ==========================================
// CLASSIFICADOR DE INTENÇÃO (LOCAL, sem IA)
// ==========================================

// Mapa de palavras-chave para intents — evita chamar o Ollama só para classificar
const INTENT_KEYWORDS = {
  combate:    /\b(atac|golp|matar|mata|feri|bater|bato|cortar|corto|disparar|disparo|lanç|lança|chut|soco|espad|flech|bala)\w*/i,
  magia:      /\b(lançar|conjur|feitiç|magia|encant|invocar|runas?)\w*/i,
  // comercio/viajar precisam vir antes de inventario/dialogo/explorar, cujos regexes
  // também capturariam palavras como "poção", "negociar" e "ir para".
  comercio:   /\b(compr|vend|loja|mercado|comerci)\w*/i,
  viajar:     /\b(viaj|ir\s+para|ir\s+até|partir\s+para|seguir\s+para)\w*/i,
  inventario: /\b(usar|uso|beber|bebi|equip|inventário|mochila|bolsa|poção|item)\w*/i,
  dialogo:    /\b(fal|diz|digo|conversar|perguntar|pergunto|negociar|negocio|cumprimentar)\w*/i,
  explorar:   /\b(examinar|examino|olhar|olho|procurar|procuro|investigar|investigo|abrir|abro|entrar|entro|ir para|mover)\w*/i,
  // estabilizar precisa vir antes de descansar/dialogo, cujos regexes ("curar"/"falar")
  // também poderiam capturar frases como "estabilizar e falar com o aliado".
  estabilizar: /\b(estabiliz)\w*/i,
  descansar:  /\b(descansar|descanso|dormir|durmo|acampar|acampo|curar|curo)\w*/i,
};

/**
 * Classifica a intenção do jogador sem precisar da IA.
 * Usa regex de palavras-chave — rápido e determinístico.
 * Retorna { intent, alvo } onde alvo é extraído heuristicamente.
 */
function classificarIntencao(action) {
  const texto = action.toLowerCase();

  for (const [intent, regex] of Object.entries(INTENT_KEYWORDS)) {
    if (regex.test(texto)) {
      // Tenta extrair o alvo: última palavra substantiva após verbos de ação
      // \b antes da preposição evita casar a letra final de outra palavra (ex.: o "o"
      // de "tento"); \b depois de "com"/"usando" evita cortar nomes que começam com
      // essas letras (ex.: "estabilizar o Companheiro" não pode truncar achando que
      // "com..." é a preposição "com").
      const alvoMatch = texto.match(/\b(?:em|no|na|o|a|contra|para)\b\s+([\w\s]+?)(?:\s+com\b|\s+usando\b|$)/i);
      const alvo      = alvoMatch ? alvoMatch[1].trim() : null;
      return { intent, alvo };
    }
  }

  return { intent: "livre", alvo: null };
}

// ==========================================
// SISTEMA DE PROMPT DO RPG MASTER
// ==========================================

/**
 * Monta o system prompt do Mestre com contexto completo do mundo.
 * Esse prompt é enviado em TODA chamada narrativa.
 */
function buildMasterSystemPrompt(player, snapshot) {
  const inimigosAtivos = snapshot.enemies
    .filter(e => e.status !== "morto")
    .map(e => `${e.nome_unico} (${e.hp_atual}/${e.hp_maximo} HP, status: ${e.status})`)
    .join(", ") || "Nenhum";

  const blocoBackground = player.background
    ? `\nBackground do personagem (escrito pelo jogador na criação — use isso para criar ganchos, referências e` +
      ` consequências narrativas ao longo da campanha; traga elementos dele à tona quando fizer sentido, não precisa` +
      ` ser em toda cena):\n"${player.background}"\n`
    : "";

  return `${TOM_VEXON}

Seu estilo: narração imersiva, tensa, com consequências reais. Máximo de 3 parágrafos por resposta.
Nunca quebre a imersão. Nunca mencione dados, modificadores ou mecânicas diretamente na narrativa.

Estado atual da cena:
- Jogador: ${player.nome} | Nível ${player.nivel} | ${player.hp_atual}/${player.hp_maximo} HP | ${player.ouro} moedas
- Inimigos na cena: ${inimigosAtivos}
- Objetivo do jogador: ${player.objetivo || "Desconhecido"}
${blocoBackground}
${getWorldContextForPrompt()}

${REGRA_SELO}`;
}

/**
 * Envia uma mensagem narrativa ao Ollama e salva no histórico da sessão.
 * Inclui as últimas N mensagens da sessão para manter contexto.
 */
async function narrar(sessao_id, systemPrompt, userPrompt, maxHistorico = 8) {
  // Salva a ação do jogador no histórico
  addMessageToSession(sessao_id, "user", userPrompt);

  // Pega o histórico recente (sem o system prompt — adicionamos na frente)
  const { getSessionMessages } = await import("../db/database.js");
  const historico = getSessionMessages(sessao_id).slice(-maxHistorico);

  const messages = [
    { role: "system", content: systemPrompt },
    ...historico,
  ];

  const respostaBruta = await callOllama(messages, NARRATIVE_TIMEOUT);
  const resposta       = aplicarTagSelo(respostaBruta);

  // Salva a resposta do mestre no histórico (já sem a tag do Selo)
  addMessageToSession(sessao_id, "assistant", resposta);

  return resposta;
}

/**
 * Detecta a tag opcional "[SELO:+N]" que o Mestre pode usar para, por conta
 * própria, avançar a rachadura do Grande Selo em um clímax cósmico real.
 * Aplica o delta no estado do mundo, registra o evento e remove a tag do
 * texto antes de devolvê-lo — o jogador nunca vê a tag crua na narrativa.
 */
function aplicarTagSelo(texto) {
  const match = texto.match(/\[SELO:\s*([+-]?\d+)\]/i);
  if (!match) return texto;

  const delta = Math.max(-10, Math.min(10, parseInt(match[1], 10) || 0));
  const textoLimpo = texto.replace(match[0], "").trim();

  if (delta !== 0) {
    deltaWorldState("rachadura_selo", delta);
    registrarEventoMundo(
      "cosmico",
      delta > 0 ? "O Mestre sente o Selo ceder um pouco mais" : "O Selo se estabiliza levemente",
      textoLimpo.slice(0, 300),
      {},
      null,
      true
    );
  }

  return textoLimpo;
}

// ==========================================
// HANDLERS DE INTENÇÃO
// ==========================================

// --- COMBATE ---
async function handleCombate(jogador_id, player, alvoNome, action, sessao_id, systemPrompt) {
  const inimigos = getActiveEnemies();

  // Auto-targeting
  let nomeFinal = alvoNome;
  if (!nomeFinal || ["ele","ela","nele","nela","monstro","inimigo"].includes(nomeFinal.toLowerCase())) {
    const vivos = inimigos.filter(e => e.status !== "morto");
    if (vivos.length === 1)      nomeFinal = vivos[0].nome_unico;
    else if (vivos.length > 1)   return resposta("Há vários inimigos aqui. Qual você quer atacar?", { erro: "multiplos_alvos" });
    else                          return resposta("Não há ameaças visíveis aqui.", { erro: "sem_alvos" });
  }

  // Busca o alvo; spawn dinâmico se não existir
  let alvo = getActiveEntityByName(nomeFinal);
  if (!alvo) {
    alvo = await spawnDinamico(nomeFinal, player, sessao_id, systemPrompt);
    if (!alvo) return resposta(`Não foi possível localizar ou criar "${nomeFinal}".`, { erro: "alvo_nao_encontrado" });
  }

  // Testa manobra especial (se o jogador descreveu algo elaborado)
  let temVantagem   = false;
  let falhouTeste   = false;
  let resultadoTeste = null;

  const ehManobra = /\b(furtiv|esgueirar|saltar|escalar|desarmar|empurrar|flanquear|surpresa)\w*/i.test(action);
  if (ehManobra) {
    resultadoTeste = rollD20Test(jogador_id, "destreza", 13);
    temVantagem    = resultadoTeste.sucesso;
    falhouTeste    = !resultadoTeste.sucesso;
  }

  // Jogador falhou na manobra — inimigo contra-ataca primeiro
  if (falhouTeste) {
    const turnoInimigo = await processEntityTurn(alvo.id, jogador_id);
    const promptFalha  = `O jogador tentou uma manobra (${action}) mas falhou feio (rolou ${resultadoTeste.total} vs dificuldade 13). Narrar a falha humilhante e a reação do ${alvo.nome_unico}.`;
    const narrativa    = await narrar(sessao_id, systemPrompt, promptFalha);
    return resposta(narrativa, { teste: resultadoTeste, acao_alvo: turnoInimigo });
  }

  // Ataque do jogador
  const ataque = calculateAttack(jogador_id, alvo.id);

  // Monta prompt narrativo com todos os fatos mecânicos
  const promptAtaque = `O jogador ${player.nome} ${action}.
Resultado mecânico: ${ataque.acertou ? `ACERTOU${ataque.critico ? " (CRÍTICO!)" : ""}` : "ERROU"}.
${ataque.acertou ? `Dano causado: ${ataque.dano}. HP restante do ${alvo.nome_unico}: ${ataque.alvo.hp_restante}.` : ""}
${ataque.alvo.morreu ? `${alvo.nome_unico} foi derrotado!` : ""}
${temVantagem ? "A manobra foi bem executada, surpreendendo o inimigo." : ""}
${ataque.habilidade_usada ? `O jogador usou sua habilidade de assinatura "${ataque.habilidade_usada}" (dano ${ataque.tipo_dano}).` : ""}
Narre o resultado sem citar números.`;

  let narrativa = await narrar(sessao_id, systemPrompt, promptAtaque);

  // Level up (XP/ouro já foram premiados dentro de calculateAttack — só narra aqui)
  if (ataque.alvo.morreu && ataque.recompensas) {
    const evo = ataque.recompensas.evolucao;
    narrativa += `\n\n**+${ataque.recompensas.xp} XP | +${ataque.recompensas.ouro} moedas**`;
    if (evo?.subiuDeNivel) {
      narrativa += `\n\n⬆️ **NÍVEL ${evo.novoNivel}!** Você ficou mais poderoso. HP máximo: ${evo.hpMaximo}.`;
    }
  }

  // Reputação de facção — abater um membro de uma facção conhecida piora a relação com ela.
  // Facções não cadastradas (ex.: "Eclipsa") simplesmente não têm efeito aqui.
  if (ataque.alvo.morreu && alvo.faccao) {
    try {
      const faccaoAlvo = getFaccaoPorNome(alvo.faccao);
      if (faccaoAlvo) modificarReputacao(jogador_id, faccaoAlvo.id, -5);
    } catch { /* reputação é um bônus narrativo — não deve derrubar o combate */ }
  }

  // Turno do inimigo (se sobreviveu)
  let turnoInimigo = null;
  if (!ataque.alvo.morreu) {
    if (temVantagem && ataque.acertou) {
      narrativa += `\n\n*${alvo.nome_unico} cambaleia com o golpe certeiro, incapaz de responder.*`;
    } else {
      turnoInimigo = await processEntityTurn(alvo.id, jogador_id);
      if (turnoInimigo) {
        const mech = turnoInimigo.dados_mecanicos;
        const promptReacao = `${alvo.nome_unico} decidiu: ${turnoInimigo.decisao}. Pensamento interno: "${turnoInimigo.pensamento}".
${mech.tipo === "ataque" ? `Atacou o jogador: ${mech.acertou ? `acertou, causando ${mech.dano_causado} de dano.` : "errou."}` : ""}
${mech.habilidade_usada ? `${alvo.nome_unico} usou sua habilidade de assinatura "${mech.habilidade_usada}" (dano ${mech.tipo_dano}).` : ""}
${mech.caiu_inconsciente ? `O jogador caiu a 0 HP e ficou inconsciente, sangrando — está morrendo.` : ""}
${mech.teste_morte?.morreu ? `O golpe foi tão grave que o jogador não resistiu.` : ""}
${mech.tipo === "fuga" ? "A entidade fugiu usando o Sistema Nemesis." : ""}
${mech.tipo === "dialogo" ? "A entidade pediu para dialogar." : ""}
Narre a reação em 1 parágrafo curto.`;
        narrativa += "\n\n" + await callOllama([
          { role: "system", content: systemPrompt },
          { role: "user",   content: promptReacao },
        ], NARRATIVE_TIMEOUT, { num_predict: 150 });
      }
    }
  }

  return resposta(narrativa, {
    ataque_jogador: ataque,
    acao_alvo:      turnoInimigo,
    teste:          resultadoTeste,
  });
}

// --- MAGIA ---
async function handleMagia(jogador_id, player, action, sessao_id, systemPrompt) {
  // Teste de Inteligência ou Sabedoria para lançar magia
  const atributoMagia = player.inteligencia >= player.sabedoria ? "inteligencia" : "sabedoria";
  const resultadoTeste = rollD20Test(jogador_id, atributoMagia, 13);

  const danoMagico = resultadoTeste.sucesso ? rollDice("2d6") + rollD20Test(jogador_id, atributoMagia, 0).total : 0;

  const prompt = `O jogador tentou: "${action}".
Teste de ${atributoMagia}: ${resultadoTeste.sucesso ? "SUCESSO" : "FALHA"} (rolou ${resultadoTeste.total}).
${resultadoTeste.sucesso ? `A magia funcionou causando ${danoMagico} de dano arcano.` : "A magia falhou de forma espetacular ou saiu diferente do esperado."}
Narre o efeito com linguagem mística do universo Vexon.`;

  const narrativa = await narrar(sessao_id, systemPrompt, prompt);
  return resposta(narrativa, { teste: resultadoTeste, dano_magico: danoMagico });
}

// --- TESTE DE PERÍCIA ---
// testeOverride vem do fallback via Ollama (gameEngine.js:processPlayerAction),
// já resolvido deterministicamente por resolverManobra — a IA nunca escolhe
// atributo/CD, só ajuda a reconhecer que a ação é um teste.
async function handleTeste(jogador_id, player, action, sessao_id, systemPrompt, testeOverride = null) {
  // Detecta atributo mencionado na ação ou usa destreza como padrão
  const atributos  = ["forca","destreza","resistencia","inteligencia","sabedoria","carisma"];
  const atributo   = testeOverride?.atributo ?? (atributos.find(a => action.toLowerCase().includes(a)) ?? "destreza");
  const dificuldade = testeOverride?.dificuldade ?? 12;

  const resultado = rollD20Test(jogador_id, atributo, dificuldade);

  const prompt = `O jogador tentou: "${action}".
Exigiu teste de ${atributo} (Dificuldade ${dificuldade}). Rolou ${resultado.total}.
Resultado: ${resultado.sucesso ? "SUCESSO" : "FALHA"}.
Narre a cena sem citar números ou mecânicas.`;

  const narrativa = await narrar(sessao_id, systemPrompt, prompt);
  return resposta(narrativa, { teste: resultado });
}

// --- DIÁLOGO ---
async function handleDialogo(player, alvoNome, action, sessao_id, systemPrompt) {
  const npc = alvoNome ? getActiveEntityByName(alvoNome) : null;

  const prompt = npc
    ? `O jogador ${player.nome} fala com ${npc.nome_unico}: "${action}".
Personalidade do NPC: ${npc.nova_personalidade || npc.personalidade || "Neutro"}.
Relação com o jogador: ${npc.relacao_com_jogador}.
Objetivo do NPC: ${npc.objetivo}.
Responda como o NPC em 1ª pessoa, mantendo sua personalidade. Depois, em nova linha, descreva brevemente a reação corporal/ambiental.`
    : `O jogador diz: "${action}". Não há nenhum NPC específico identificado. Narre a ausência de resposta ou o ambiente reagindo.`;

  const narrativa = await narrar(sessao_id, systemPrompt, prompt);
  return resposta(narrativa, { npc: npc?.nome_unico ?? null });
}

// --- INVENTÁRIO ---
async function handleInventario(jogador_id, player, alvoNome, sessao_id) {
  if (!alvoNome || alvoNome === "nenhum") {
    const inv = getPlayerInventory(jogador_id);
    return resposta(
      `📦 **Inventário de ${player.nome}**\n${inv.map(i => `- ${i.quantidade}x ${i.nome}${i.equipado ? " [equipado]" : ""}`).join("\n") || "Vazio."}\n💰 Ouro: ${player.ouro}`,
      { inventario: inv, ouro: player.ouro }
    );
  }

  const itemUsado = consumeItem(jogador_id, alvoNome);
  if (!itemUsado) {
    return resposta(`Você não tem "${alvoNome}" no inventário.`, { erro: "item_nao_encontrado" });
  }

  // Cura
  const ehCura = /poção|cura|kit|bandagem|elixir/i.test(itemUsado.nome);
  if (ehCura) {
    const cura   = rollDice("1d8") + 4; // 1d8+4 de cura
    const novoHp = Math.min(player.hp_maximo, player.hp_atual + cura);
    updatePlayerHP(jogador_id, novoHp);

    // Cura acima de 0 HP tira o personagem de inconsciente/estável (Readme.txt:
    // ganhar HP enquanto caído interrompe o teste contra a morte).
    const estavaCaido = player.status === "inconsciente" || player.status === "estavel";
    if (estavaCaido && novoHp > 0) updatePlayerStatus(jogador_id, "ativo");

    logWorldEvent("item", `${player.nome} usou ${itemUsado.nome} e recuperou ${cura} HP.`, [jogador_id]);
    return resposta(
      `Você usa **${itemUsado.nome}**. O líquido percorre suas veias${estavaCaido ? " e você recobra a consciência" : ""}. Recupera **${cura} HP** (${novoHp}/${player.hp_maximo}).`,
      { item: itemUsado.nome, cura, hp_novo: novoHp, reviveu: estavaCaido && novoHp > 0 }
    );
  }

  return resposta(`Você usa **${itemUsado.nome}**.`, { item: itemUsado.nome });
}

// --- COMÉRCIO ---
async function handleComercio(jogador_id, player, action) {
  const textoLower = action.toLowerCase();
  const modoVenda   = /\bvend/i.test(textoLower);

  const posicao     = getPosicaoJogador(jogador_id);
  const localAtual   = posicao?.local_atual;
  const todasLojas   = getLojas();
  const lojasLocais  = localAtual
    ? todasLojas.filter(l => l.local && (l.local.includes(localAtual) || localAtual.includes(l.local)))
    : [];
  const lojas = lojasLocais.length > 0 ? lojasLocais : todasLojas;

  if (lojas.length === 0) {
    return resposta("Não há nenhuma loja por perto.", { lojas: [] });
  }

  if (modoVenda) {
    const inv     = getPlayerInventory(jogador_id);
    const itemInv = inv.find(i => textoLower.includes(i.nome.toLowerCase()));
    if (!itemInv) {
      return resposta(
        `Vender o quê? Seu inventário: ${inv.map(i => i.nome).join(", ") || "vazio"}.`,
        { inventario: inv }
      );
    }
    try {
      const resultado = venderItem(jogador_id, lojas[0].id, itemInv.id, 1);
      return resposta(
        `Você vendeu **${resultado.item}** para ${lojas[0].nome} por **${resultado.preco_total} moedas**.`,
        { venda: resultado }
      );
    } catch (e) {
      return resposta(`Não foi possível vender: ${e.message}`, { erro: e.message });
    }
  }

  // Modo compra
  const loja     = lojas[0];
  const estoque  = getEstoqueLoja(loja.id, jogador_id);
  const itemLoja = estoque.find(i => textoLower.includes(i.nome.toLowerCase()));

  if (!itemLoja) {
    const lista = estoque.map(i => `${i.nome} (${i.preco_dinamico?.ouro ?? i.preco_loja_ouro} po)`).join(", ") || "nada à venda";
    return resposta(
      `🏪 **${loja.nome}**\nÀ venda: ${lista}\n💰 Seu ouro: ${player.ouro}`,
      { loja, estoque }
    );
  }

  try {
    const resultado = comprarItem(jogador_id, loja.id, itemLoja.item_id, 1);
    return resposta(`Você comprou **${resultado.item}** de ${loja.nome} por ${resultado.preco_total} moedas.`, { compra: resultado });
  } catch (e) {
    return resposta(`Não foi possível comprar: ${e.message}`, { erro: e.message });
  }
}

// --- VIAGEM ---
async function handleViagem(jogador_id, alvoNome) {
  const posicao    = getPosicaoJogador(jogador_id);
  const localAtual = posicao?.local_atual;

  if (!alvoNome) {
    const conectados = getLocaisConectados(localAtual);
    const lista = conectados.map(l => l.nome).join(", ") || "nenhum local conectado conhecido";
    return resposta(`📍 Você está em **${localAtual}**.\nLocais alcançáveis: ${lista}`, { local_atual: localAtual, conectados });
  }

  // classificarIntencao entrega o alvo em minúsculas, mas getLocalByNome faz
  // correspondência exata — resolve o nome real (com caixa correta) antes de viajar.
  const destinoReal = getLocaisAtivos().find(
    l => l.nome.toLowerCase().includes(alvoNome.toLowerCase())
  )?.nome ?? alvoNome;

  try {
    const viagem = iniciarViagem(jogador_id, destinoReal);
    return resposta(
      `Você parte de ${localAtual} rumo a **${destinoReal}**. Chegada estimada em ${viagem.tempo_viagem_min ?? "alguns"} minutos.`,
      { viagem }
    );
  } catch (e) {
    return resposta(`Não foi possível viajar: ${e.message}`, { erro: e.message });
  }
}

// --- EXPLORAÇÃO ---
async function handleExplorar(player, action, sessao_id, systemPrompt) {
  const prompt = `O jogador ${player.nome} ${action}.
Descreva o que ele encontra, vê ou sente. Detalhe o ambiente com elementos do universo Vexon.
Se houver algo interessante (item, pista, perigo oculto), mencione sutilmente.`;
  const narrativa = await narrar(sessao_id, systemPrompt, prompt);
  return resposta(narrativa, { exploracao: true });
}

// --- DESCANSO ---
// Distingue curto/longo pelo texto da ação (Readme.txt "Regras de Descanso").
// "acampar"/"dormir"/"noite"/"longo" indicam Descanso Longo; qualquer outra
// menção a descansar/curar, sem essas palavras, é tratada como Descanso Curto.
async function handleDescanso(jogador_id, player, action, sessao_id, systemPrompt) {
  const textoLower = action.toLowerCase();
  const ehLongo    = /\b(longo|noite|acampar|acampo|dormir|durmo)\w*/i.test(textoLower);

  try {
    if (ehLongo) {
      const r = descansoLongo(jogador_id);
      const prompt = `${player.nome} fez um Descanso Longo em segurança e recuperou todo o HP (${r.hp_depois}/${r.hp_maximo}), além de todos os Dados de Vida. Narre o descanso brevemente.`;
      const narrativa = await narrar(sessao_id, systemPrompt, prompt);
      return resposta(narrativa, { descanso: r });
    }

    const qtdMatch = textoLower.match(/(\d+)\s*dados?/i);
    const quantidade = qtdMatch ? Number(qtdMatch[1]) : 1;

    const r = descansoCurto(jogador_id, quantidade);
    const prompt = `${player.nome} fez um Descanso Curto, gastou ${r.dados_gastos} Dado(s) de Vida e recuperou ${r.cura_total} HP (${r.hp_depois}/${r.hp_maximo}). Restam ${r.dados_restantes} Dados de Vida disponíveis. Narre o descanso brevemente.`;
    const narrativa = await narrar(sessao_id, systemPrompt, prompt);
    return resposta(narrativa, { descanso: r });
  } catch (e) {
    return resposta(e.message, { erro: e.message });
  }
}

// --- TESTE CONTRA A MORTE ---
// Roda automaticamente a cada ação enquanto o jogador está inconsciente (0 HP) —
// substitui o processamento normal da ação, conforme "no início de cada um dos
// seus turnos" (Readme.txt, "Caindo a 0 Pontos de Vida").
async function handleTesteMorte(jogador_id, player, sessao_id, systemPrompt) {
  const r = rollDeathSave(jogador_id);

  let desfecho;
  if (r.resultado === "recuperou_consciencia") {
    desfecho = `Rolou um 20 natural! ${player.nome} recupera 1 HP imediatamente e volta à consciência.`;
  } else if (r.resultado === "morreu") {
    desfecho = `${player.nome} acumulou 3 falhas e morreu.`;
  } else if (r.resultado === "estabilizou") {
    desfecho = `${player.nome} acumulou 3 sucessos e estabilizou — continua inconsciente, mas parou de morrer.`;
  } else if (r.resultado === "sucesso") {
    desfecho = `Sucesso no teste contra a morte (${r.sucessos}/3 sucessos, ${r.falhas}/3 falhas).`;
  } else {
    desfecho = `Falha no teste contra a morte${r.natural1 ? " (1 natural — conta como duas falhas)" : ""} (${r.sucessos}/3 sucessos, ${r.falhas}/3 falhas).`;
  }

  const prompt = `${player.nome} está inconsciente a 0 HP e faz um teste contra a morte. ${desfecho} Narre a cena sem citar números ou mecânicas.`;
  const narrativa = await narrar(sessao_id, systemPrompt, prompt);
  return resposta(narrativa, { teste_morte: r });
}

// --- ESTABILIZAR ALIADO ---
async function handleEstabilizar(jogador_id, player, alvo, action, sessao_id, systemPrompt) {
  try {
    const r = estabilizarAliado(jogador_id, alvo);
    const prompt = `${player.nome} tenta estabilizar ${r.alvo} com um teste de Inteligência (Medicina) CD 10. ` +
      `${r.estabilizado ? `Conseguiu — ${r.alvo} volta com 1 HP.` : `Não conseguiu.`} Narre a cena sem citar números ou mecânicas.`;
    const narrativa = await narrar(sessao_id, systemPrompt, prompt);
    return resposta(narrativa, { estabilizar: r });
  } catch (e) {
    return resposta(e.message, { erro: e.message });
  }
}

// --- AÇÃO LIVRE ---
async function handleLivre(player, action, sessao_id, systemPrompt) {
  // Primeiro: verifica se a IA quer criar uma entidade (tool-use simples)
  const promptVerifica = `O jogador de Vexon fez: "${action}".
Se isso exige criar um monstro ou NPC, responda APENAS com JSON: { "criar": true, "tipo": "monstro"|"npc", "nome": string, "nivel": number }
Se não, responda APENAS com: { "criar": false }`;

  let criarEntidade = false;
  try {
    const raw   = await callOllama([{ role: "user", content: promptVerifica }], INTENT_TIMEOUT, { temperature: 0.2, num_predict: 80 });
    const parsed = extrairJson(raw);
    if (parsed.criar === true && parsed.nome) {
      criarEntidade = parsed;
    }
  } catch { /* sem problema — fallback para narrativa livre */ }

  if (criarEntidade) {
    try {
      const nivel = criarEntidade.nivel || 1;
      const hp    = 10 + nivel * 8;
      db.prepare(`
        INSERT INTO entidades_vivas (tipo_entidade, nome_unico, hp_maximo, hp_atual, ca, nivel, status)
        VALUES (?, ?, ?, ?, ?, ?, 'vivo')
      `).run(criarEntidade.tipo, criarEntidade.nome, hp, hp, 10 + nivel, nivel);
      logWorldEvent("spawn", `${criarEntidade.nome} emergiu no mundo (ação livre).`, []);
    } catch (e) {
      console.error("[Livre] Erro ao criar entidade:", e.message);
    }
  }

  const narrativa = await narrar(sessao_id, systemPrompt, action);
  return resposta(narrativa, { acao_livre: true });
}

// ==========================================
// SPAWN DINÂMICO (quando o alvo não existe)
// ==========================================

async function spawnDinamico(nome, player, sessao_id, systemPrompt) {
  console.log(`[Spawn] Criando "${nome}" dinamicamente...`);
  try {
    const nivel = player.nivel;
    const hp    = 10 + nivel * 8;
    db.prepare(`
      INSERT INTO entidades_vivas (tipo_entidade, nome_unico, hp_maximo, hp_atual, ca, nivel, status)
      VALUES ('monstro', ?, ?, ?, ?, ?, 'vivo')
    `).run(nome, hp, hp, 10 + nivel, nivel);
    logWorldEvent("spawn", `${nome} apareceu (spawn dinâmico por combate).`, []);
    return getActiveEntityByName(nome);
  } catch (e) {
    console.error("[Spawn] Falha:", e.message);
    return null;
  }
}

// ==========================================
// HELPER DE RESPOSTA PADRONIZADA
// ==========================================

function resposta(narrativa, dados_mecanicos = {}) {
  return { narrativa, dados_mecanicos };
}

// ==========================================
// FUNÇÃO PRINCIPAL
// ==========================================

/**
 * Processa a ação do jogador e retorna narrativa + dados mecânicos.
 * Ponto de entrada central do jogo.
 *
 * @param {number} jogador_id
 * @param {string} action      - Texto livre da ação do jogador
 * @returns {Promise<object>}
 */
export async function processPlayerAction(jogador_id, action) {
  const player = getPlayer(jogador_id);
  if (!player) throw new Error(`Jogador ${jogador_id} não encontrado.`);
  if (!action?.trim()) throw new Error("Ação vazia.");

  // Sessão ativa do jogador (contexto do Ollama)
  const sessao   = getOrCreateActiveSession(jogador_id);
  const sessao_id = sessao.id;

  // Snapshot do mundo para o system prompt
  const snapshot     = getWorldSnapshot(jogador_id);
  const systemPrompt = buildMasterSystemPrompt(player, snapshot);

  // Classifica a intenção localmente (sem IA — rápido e gratuito)
  let { intent, alvo } = classificarIntencao(action);

  // Despacha para o handler correto
  let resultado;
  try {
    // Exceção: mesmo inconsciente/estável, usar um item (ex.: poção de cura) ainda
    // passa — é o único jeito de sair desse estado sem outro personagem por perto.
    const podeUsarItemMesmoCaido = intent === "inventario";

    if (player.status === "morto") {
      resultado = resposta(`${player.nome} está morto. A história dele chegou ao fim.`, { status: "morto" });
    } else if (player.status === "inconsciente" && !podeUsarItemMesmoCaido) {
      // Enquanto inconsciente, todo turno é um teste contra a morte — a ação
      // digitada é ignorada (o personagem não pode agir).
      resultado = await handleTesteMorte(jogador_id, player, sessao_id, systemPrompt);
    } else if (player.status === "estavel" && !podeUsarItemMesmoCaido) {
      // Estabilizado: parou de rolar contra a morte, mas continua inconsciente
      // e incapaz de agir — só volta com cura externa (poção, magia, etc.).
      resultado = resposta(
        `${player.nome} está inconsciente, mas estável — respira fracamente. Precisa de cura para acordar.`,
        { status: "estavel" }
      );
    } else {
      // Fallback via Ollama: a regex local não reconheceu a ação ("livre").
      // Cobre casos ambíguos (ex.: "eu tento escalar o muro") que antes caíam
      // direto em narração livre sem nenhuma resolução mecânica. Se o Ollama
      // também não identificar nada, ou falhar/der timeout, segue "livre" normalmente.
      let testeInfo = null;
      if (intent === "livre") {
        try {
          const viaOllama = await classificarComOllama(action);
          if (viaOllama.intent !== "livre") {
            intent = viaOllama.intent;
            if (viaOllama.alvo) alvo = viaOllama.alvo;
            if (intent === "teste") testeInfo = resolverManobra(action);
          }
        } catch (e) {
          console.warn(`[GameEngine] Fallback via Ollama indisponível: ${e.message}`);
        }
      }

      switch (intent) {
        case "combate":     resultado = await handleCombate(jogador_id, player, alvo, action, sessao_id, systemPrompt);     break;
        case "magia":       resultado = await handleMagia(jogador_id, player, action, sessao_id, systemPrompt);             break;
        case "teste":       resultado = await handleTeste(jogador_id, player, action, sessao_id, systemPrompt, testeInfo);  break;
        case "dialogo":     resultado = await handleDialogo(player, alvo, action, sessao_id, systemPrompt);                 break;
        case "comercio":    resultado = await handleComercio(jogador_id, player, action);                                   break;
        case "viajar":      resultado = await handleViagem(jogador_id, alvo);                                               break;
        case "inventario":  resultado = await handleInventario(jogador_id, player, alvo, sessao_id);                        break;
        case "explorar":    resultado = await handleExplorar(player, action, sessao_id, systemPrompt);                      break;
        case "estabilizar": resultado = await handleEstabilizar(jogador_id, player, alvo, action, sessao_id, systemPrompt); break;
        case "descansar":   resultado = await handleDescanso(jogador_id, player, action, sessao_id, systemPrompt);          break;
        default:            resultado = await handleLivre(player, action, sessao_id, systemPrompt);
      }
    }
  } catch (err) {
    console.error(`[GameEngine] Erro no handler "${intent}":`, err.message);
    resultado = resposta(
      "O éter distorceu sua ação. Algo falhou nas camadas do mundo.",
      { erro: err.message }
    );
  }

  // ==========================================
  // RETORNO FINAL COM STATUS ATUALIZADO DO HUD
  // ==========================================
  const statusFinal = getPlayer(jogador_id);

  return {
    narrativa:       resultado.narrativa,
    dados_mecanicos: {
      ...resultado.dados_mecanicos,
      intent,
      // Estado atualizado do jogador para o HUD React (campos soltos — é o formato que o frontend lê)
      hp:            statusFinal.hp_atual,
      hp_maximo:     statusFinal.hp_maximo,
      ouro:          statusFinal.ouro,
      nivel:         statusFinal.nivel,
      xp:            statusFinal.xp,
      xp_necessario: statusFinal.xp_necessario,
      habilidades:   statusFinal.habilidades,
      inventario:    getPlayerInventory(jogador_id),
      inimigos:      getActiveEnemies(),
    },
  };
}