// ==========================================
// ECONOMY ENGINE — VEXON (PARTE 1 DE 2)
// Banco, moedas, preços dinâmicos e lojas
// ==========================================

import db, { logWorldEvent, toJson, parseJson, getPlayer } from "../db/database.js";
import { getFullWorldState, deltaWorldState, callOllamaWorld } from "../ia/worldEngine.js";

// ==========================================
// TABELAS DO BANCO DE DADOS
// ==========================================

db.exec(`
  CREATE TABLE IF NOT EXISTS carteiras (
    jogador_id  INTEGER PRIMARY KEY,
    ouro        INTEGER DEFAULT 0,
    creditos    INTEGER DEFAULT 0,   -- Créditos corporativos (Darvoss/VarnCore)
    favor       INTEGER DEFAULT 0,   -- Moeda de influência política
    FOREIGN KEY (jogador_id) REFERENCES jogadores(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS lojas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nome        TEXT NOT NULL,
    tipo        TEXT NOT NULL,  -- 'fixa'|'mercado_negro'|'leilao'
    npc_dono_id INTEGER,
    faccao      TEXT,
    local       TEXT,
    desconto_base REAL DEFAULT 1.0,  -- Multiplicador de preço base
    ativa       INTEGER DEFAULT 1,
    criada_em   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS loja_estoque (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    loja_id     INTEGER NOT NULL,
    item_id     INTEGER NOT NULL,
    quantidade  INTEGER DEFAULT 1,   -- -1 = infinito
    preco_ouro  INTEGER DEFAULT 0,
    preco_creditos INTEGER DEFAULT 0,
    preco_favor INTEGER DEFAULT 0,
    FOREIGN KEY (loja_id) REFERENCES lojas(id) ON DELETE CASCADE,
    FOREIGN KEY (item_id) REFERENCES itens(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS transacoes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    jogador_id  INTEGER NOT NULL,
    loja_id     INTEGER,
    tipo        TEXT NOT NULL,  -- 'compra'|'venda'|'leilao'|'transferencia'|'recompensa'
    item_id     INTEGER,
    quantidade  INTEGER DEFAULT 1,
    ouro        INTEGER DEFAULT 0,
    creditos    INTEGER DEFAULT 0,
    favor       INTEGER DEFAULT 0,
    descricao   TEXT,
    timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (jogador_id) REFERENCES jogadores(id)
  );

  CREATE TABLE IF NOT EXISTS leiloes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id         INTEGER NOT NULL,
    vendedor_id     INTEGER,         -- jogador ou null se NPC
    vendedor_npc    TEXT,
    lance_minimo    INTEGER DEFAULT 1,
    lance_atual     INTEGER DEFAULT 0,
    maior_licitante INTEGER,         -- jogador_id
    moeda           TEXT DEFAULT 'ouro',
    encerra_em      DATETIME NOT NULL,
    status          TEXT DEFAULT 'ativo',  -- 'ativo'|'encerrado'|'cancelado'
    criado_em       DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES itens(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS lances_leilao (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    leilao_id   INTEGER NOT NULL,
    jogador_id  INTEGER NOT NULL,
    valor       INTEGER NOT NULL,
    moeda       TEXT DEFAULT 'ouro',
    timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (leilao_id) REFERENCES leiloes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS indice_preco (
    item_nome   TEXT PRIMARY KEY,
    preco_base  INTEGER NOT NULL,
    modificador REAL DEFAULT 1.0,   -- Modificador atual (inflação/deflação)
    ultima_atualizacao DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_transacoes_jogador ON transacoes(jogador_id);
  CREATE INDEX IF NOT EXISTS idx_leiloes_status ON leiloes(status);
  CREATE INDEX IF NOT EXISTS idx_lances_leilao ON lances_leilao(leilao_id);
  CREATE INDEX IF NOT EXISTS idx_estoque_loja ON loja_estoque(loja_id);
`);

// ==========================================
// CONFIGURAÇÃO — MOEDAS E TAXAS
// ==========================================

// Taxa de conversão entre moedas
export const TAXA_CONVERSAO = {
  ouro_para_creditos:  0.7,   // 1 ouro = 0.7 créditos (corporativo vale mais)
  creditos_para_ouro:  1.4,   // 1 crédito = 1.4 ouro
  favor_para_ouro:     20,    // 1 favor = 20 ouro (muito valioso)
  ouro_para_favor:     0.05,  // 1 ouro = 0.05 favor
};

// Quanto o estado do mundo afeta os preços
const MODIFICADORES_MUNDO = {
  quasiluz_alta:      { limiar: 60, modificador: 1.3,  itens: ["implante", "cibernetico", "chip"] },
  irmandade_forte:    { limiar: 70, modificador: 1.5,  itens: ["arma", "veneno", "magia"] },
  darvoss_fraca:      { limiar: 30, modificador: 1.4,  itens: ["creditos", "cibernetico"] },
  resistencia_forte:  { limiar: 60, modificador: 0.8,  itens: ["consumivel", "cura"] },
  vacuo_alto:         { limiar: 40, modificador: 2.0,  itens: ["artefato", "runa"] },
  criancas_desap:     { limiar: 5,  modificador: 0.7,  itens: ["favor"] }, // crise moral = favor vale menos
};

// ==========================================
// CARTEIRAS — GERENCIAR SALDOS
// ==========================================

/**
 * Obtém ou cria a carteira do jogador.
 */
export function getCarteira(jogador_id) {
  let carteira = db.prepare("SELECT * FROM carteiras WHERE jogador_id = ?").get(jogador_id);

  if (!carteira) {
    const player = getPlayer(jogador_id);
    const ouroInicial = player?.ouro ?? 0;
    db.prepare(`
      INSERT INTO carteiras (jogador_id, ouro, creditos, favor)
      VALUES (?, ?, 0, 0)
    `).run(jogador_id, ouroInicial);
    carteira = db.prepare("SELECT * FROM carteiras WHERE jogador_id = ?").get(jogador_id);
  }

  return carteira;
}

/**
 * Adiciona ou remove valores da carteira.
 * Retorna o novo saldo.
 */
export function modificarCarteira(jogador_id, { ouro = 0, creditos = 0, favor = 0 }) {
  const carteira = getCarteira(jogador_id);

  const novoOuro     = Math.max(0, carteira.ouro     + ouro);
  const novoCreditos = Math.max(0, carteira.creditos + creditos);
  const novoFavor    = Math.max(0, carteira.favor    + favor);

  db.prepare(`
    UPDATE carteiras
    SET ouro = ?, creditos = ?, favor = ?
    WHERE jogador_id = ?
  `).run(novoOuro, novoCreditos, novoFavor, jogador_id);

  // Sincroniza ouro com tabela jogadores
  db.prepare("UPDATE jogadores SET ouro = ? WHERE id = ?").run(novoOuro, jogador_id);

  return { ouro: novoOuro, creditos: novoCreditos, favor: novoFavor };
}

/**
 * Verifica se o jogador tem saldo suficiente.
 */
export function temSaldo(jogador_id, { ouro = 0, creditos = 0, favor = 0 }) {
  const carteira = getCarteira(jogador_id);
  return (
    carteira.ouro     >= ouro     &&
    carteira.creditos >= creditos &&
    carteira.favor    >= favor
  );
}

/**
 * Converte moedas.
 */
export function converterMoeda(valor, de, para) {
  const chave = `${de}_para_${para}`;
  const taxa  = TAXA_CONVERSAO[chave];
  if (!taxa) throw new Error(`Conversão ${de} → ${para} não suportada.`);
  return Math.floor(valor * taxa);
}

// ==========================================
// SISTEMA DE PREÇOS DINÂMICOS
// ==========================================

/**
 * Calcula o modificador de preço atual baseado no estado do mundo.
 * Retorna um multiplicador (ex: 1.3 = 30% mais caro).
 */
export function calcularModificadorPreco(item_tipo, item_nome = "") {
  const estado = getFullWorldState();
  let modificador = 1.0;

  const tipoNome = `${item_tipo} ${item_nome}`.toLowerCase();

  for (const [chave, config] of Object.entries(MODIFICADORES_MUNDO)) {
    const contadorNome = chave
      .replace("_alta", "").replace("_forte", "").replace("_fraca", "").replace("_alto", "");

    let valorAtual = 0;
    if (chave === "quasiluz_alta")   valorAtual = estado.nivel_quasiluz;
    if (chave === "irmandade_forte") valorAtual = estado.poder_irmandade;
    if (chave === "darvoss_fraca")   valorAtual = 100 - estado.poder_darvoss;
    if (chave === "resistencia_forte") valorAtual = estado.poder_resistencia;
    if (chave === "vacuo_alto")      valorAtual = estado.influencia_vacuo;
    if (chave === "criancas_desap")  valorAtual = estado.criancas_desaparecidas * 10;

    const condicaoAtiva = chave.includes("fraca")
      ? valorAtual >= config.limiar
      : valorAtual >= config.limiar;

    if (condicaoAtiva) {
      const itemAfetado = config.itens.some(t => tipoNome.includes(t));
      if (itemAfetado) modificador *= config.modificador;
    }
  }

  // Clamp: preço nunca menor que 50% nem maior que 300% do base
  return Math.max(0.5, Math.min(3.0, modificador));
}

/**
 * Calcula o preço final de um item considerando:
 * - Preço base do item
 * - Modificador do estado do mundo
 * - Desconto por reputação com a facção da loja
 * - Margem da loja
 */
export function calcularPrecoFinal(item, loja, rep_desconto = 1.0) {
  const precoBase  = item.valor
    ? parseInt(String(item.valor).replace(/[^\d]/g, "")) || 50
    : 50;

  const modMundo   = calcularModificadorPreco(item.tipo, item.nome);
  const margemLoja = loja?.desconto_base ?? 1.0;

  const precoFinal = Math.max(1, Math.round(precoBase * modMundo * margemLoja * rep_desconto));

  return {
    base:      precoBase,
    modificador_mundo: modMundo,
    margem_loja: margemLoja,
    desconto_reputacao: rep_desconto,
    final:     precoFinal,
  };
}

// ==========================================
// LOJAS FIXAS
// ==========================================

/**
 * Inicializa as lojas padrão de Vexon.
 */
export function inicializarLojas() {
  const existentes = db.prepare("SELECT COUNT(*) as t FROM lojas").get().t;
  if (existentes > 0) return;

  const lojasPadrao = [
    {
      nome: "Forja da Mira",
      tipo: "fixa",
      faccao: "Cidadãos de Vexon",
      local: "Distrito Industrial de Vexon",
      desconto_base: 1.0,
    },
    {
      nome: "Mercado das Sombras",
      tipo: "mercado_negro",
      faccao: "Mercado Negro",
      local: "Becos de Vexon",
      desconto_base: 1.3,  // Mercado negro é mais caro
    },
    {
      nome: "Clínica Clandestina Kallos",
      tipo: "fixa",
      faccao: "VarnCore Remanescente",
      local: "Nova Varnhold",
      desconto_base: 1.2,
    },
    {
      nome: "Leilões da Linha Morta",
      tipo: "leilao",
      faccao: "Mercado Negro",
      local: "Linha Morta",
      desconto_base: 1.0,
    },
  ];

  let forjaId = null;
  for (const loja of lojasPadrao) {
    const result = db.prepare(`
      INSERT INTO lojas (nome, tipo, faccao, local, desconto_base)
      VALUES (?, ?, ?, ?, ?)
    `).run(loja.nome, loja.tipo, loja.faccao, loja.local, loja.desconto_base);
    if (loja.nome === "Forja da Mira") forjaId = result.lastInsertRowid;
  }

  // Estoque inicial da Forja da Mira, usando itens já criados pelo equipamento
  // inicial do jogador em createProfile.js. Sem esses itens, a loja fica vazia
  // (não quebra nada, só não há o que comprar até o compêndio ser semeado).
  if (forjaId) {
    const itensEstoque = [
      { nome: "Poção de Cura",              quantidade: -1, preco_ouro: 50 },
      { nome: "Kit de Ferramentas de Ladrão", quantidade: -1, preco_ouro: 25 },
    ];
    for (const entrada of itensEstoque) {
      const item = db.prepare("SELECT id FROM itens WHERE nome = ?").get(entrada.nome);
      if (!item) continue;
      db.prepare(`
        INSERT INTO loja_estoque (loja_id, item_id, quantidade, preco_ouro)
        VALUES (?, ?, ?, ?)
      `).run(forjaId, item.id, entrada.quantidade, entrada.preco_ouro);
    }
  }

  console.log("[EconomyEngine] Lojas inicializadas.");
}

/**
 * Retorna todas as lojas ativas.
 */
export function getLojas(tipo = null) {
  if (tipo) {
    return db.prepare("SELECT * FROM lojas WHERE ativa = 1 AND tipo = ?").all(tipo);
  }
  return db.prepare("SELECT * FROM lojas WHERE ativa = 1").all();
}

/**
 * Retorna o estoque de uma loja com preços calculados.
 */
export function getEstoqueLoja(loja_id, jogador_id = null) {
  const loja = db.prepare("SELECT * FROM lojas WHERE id = ?").get(loja_id);
  if (!loja) throw new Error(`Loja ${loja_id} não encontrada.`);

  const itens = db.prepare(`
    SELECT le.*, it.*,
      le.id as estoque_id,
      le.preco_ouro as preco_loja_ouro,
      le.preco_creditos as preco_loja_creditos,
      le.preco_favor as preco_loja_favor
    FROM loja_estoque le
    JOIN itens it ON le.item_id = it.id
    WHERE le.loja_id = ? AND (le.quantidade > 0 OR le.quantidade = -1)
  `).all(loja_id);

  // Aplica preços dinâmicos
  return itens.map(item => {
    const preco = calcularPrecoFinal(item, loja);
    return {
      ...item,
      preco_dinamico: {
        ouro:     item.preco_loja_ouro > 0 ? Math.round(item.preco_loja_ouro * preco.modificador_mundo) : 0,
        creditos: item.preco_loja_creditos,
        favor:    item.preco_loja_favor,
        modificador_mundo: preco.modificador_mundo,
      },
    };
  });
}

// ==========================================
// COMPRA E VENDA
// ==========================================

/**
 * Processa uma compra do jogador em uma loja.
 */
export function comprarItem(jogador_id, loja_id, item_id, quantidade, moeda = "ouro") {
  const loja    = db.prepare("SELECT * FROM lojas WHERE id = ?").get(loja_id);
  const estoque = db.prepare(`
    SELECT le.*, it.* FROM loja_estoque le
    JOIN itens it ON le.item_id = it.id
    WHERE le.loja_id = ? AND le.item_id = ?
  `).get(loja_id, item_id);

  if (!estoque) throw new Error("Item não disponível nesta loja.");
  if (estoque.quantidade !== -1 && estoque.quantidade < quantidade) {
    throw new Error(`Estoque insuficiente. Disponível: ${estoque.quantidade}`);
  }

  // Calcula preço
  const preco = calcularPrecoFinal(estoque, loja);
  const precoTotal = preco.final * quantidade;

  // Verifica saldo
  const pagamento = { [moeda]: precoTotal };
  if (!temSaldo(jogador_id, pagamento)) {
    throw new Error(`Saldo insuficiente. Precisa: ${precoTotal} ${moeda}.`);
  }

  // Debita saldo
  modificarCarteira(jogador_id, { [moeda]: -precoTotal });

  // Adiciona ao inventário
  const itemNoInv = db.prepare(`
    SELECT id, quantidade FROM inventario
    WHERE jogador_id = ? AND item_id = ?
  `).get(jogador_id, item_id);

  if (itemNoInv) {
    db.prepare("UPDATE inventario SET quantidade = quantidade + ? WHERE id = ?")
      .run(quantidade, itemNoInv.id);
  } else {
    db.prepare("INSERT INTO inventario (jogador_id, item_id, quantidade) VALUES (?, ?, ?)")
      .run(jogador_id, item_id, quantidade);
  }

  // Atualiza estoque
  if (estoque.quantidade !== -1) {
    db.prepare("UPDATE loja_estoque SET quantidade = quantidade - ? WHERE id = ?")
      .run(quantidade, estoque.id);
  }

  // Registra transação
  db.prepare(`
    INSERT INTO transacoes (jogador_id, loja_id, tipo, item_id, quantidade, ${moeda}, descricao)
    VALUES (?, ?, 'compra', ?, ?, ?, ?)
  `).run(jogador_id, loja_id, item_id, quantidade, precoTotal, `Compra: ${estoque.nome} x${quantidade}`);

  return {
    item: estoque.nome,
    quantidade,
    preco_unitario: preco.final,
    preco_total: precoTotal,
    moeda,
    modificador_mundo: preco.modificador_mundo,
  };
}

/**
 * Processa uma venda do jogador para uma loja.
 * Lojas compram por 50% do valor dinâmico.
 */
export function venderItem(jogador_id, loja_id, item_id, quantidade, moeda = "ouro") {
  const loja  = db.prepare("SELECT * FROM lojas WHERE id = ?").get(loja_id);
  const item  = db.prepare("SELECT * FROM itens WHERE id = ?").get(item_id);
  if (!item) throw new Error("Item não encontrado.");

  const invItem = db.prepare(`
    SELECT * FROM inventario WHERE jogador_id = ? AND item_id = ?
  `).get(jogador_id, item_id);
  if (!invItem || invItem.quantidade < quantidade) {
    throw new Error("Você não tem essa quantidade no inventário.");
  }

  // Loja paga 50% do valor
  const preco = calcularPrecoFinal(item, loja);
  const precoVenda = Math.max(1, Math.floor(preco.final * 0.5)) * quantidade;

  // Remove do inventário
  const novaQtd = invItem.quantidade - quantidade;
  if (novaQtd <= 0) {
    db.prepare("DELETE FROM inventario WHERE id = ?").run(invItem.id);
  } else {
    db.prepare("UPDATE inventario SET quantidade = ? WHERE id = ?").run(novaQtd, invItem.id);
  }

  // Credita saldo
  modificarCarteira(jogador_id, { [moeda]: precoVenda });

  // Registra
  db.prepare(`
    INSERT INTO transacoes (jogador_id, loja_id, tipo, item_id, quantidade, ${moeda}, descricao)
    VALUES (?, ?, 'venda', ?, ?, ?, ?)
  `).run(jogador_id, loja_id, item_id, quantidade, precoVenda, `Venda: ${item.nome} x${quantidade}`);

  return {
    item: item.nome,
    quantidade,
    preco_unitario: Math.floor(preco.final * 0.5),
    preco_total: precoVenda,
    moeda,
  };
}

// ==========================================
// LEILÕES
// ==========================================

/**
 * Cria um leilão.
 */
export function criarLeilao(item_id, lance_minimo, moeda = "ouro", duracao_minutos = 30, vendedor_id = null, vendedor_npc = null) {
  const encerra_em = new Date(Date.now() + duracao_minutos * 60_000);

  const result = db.prepare(`
    INSERT INTO leiloes (item_id, vendedor_id, vendedor_npc, lance_minimo, moeda, encerra_em)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(item_id, vendedor_id, vendedor_npc, lance_minimo, moeda, encerra_em.toISOString());

  logWorldEvent("leilao_criado", `Leilão criado para item ${item_id}`, []);
  return result.lastInsertRowid;
}

/**
 * Processa um lance em um leilão.
 */
export function darLance(jogador_id, leilao_id, valor) {
  const leilao = db.prepare("SELECT * FROM leiloes WHERE id = ?").get(leilao_id);
  if (!leilao) throw new Error("Leilão não encontrado.");
  if (leilao.status !== "ativo") throw new Error("Leilão não está ativo.");
  if (new Date(leilao.encerra_em) < new Date()) throw new Error("Leilão encerrado.");
  if (valor <= leilao.lance_atual || valor < leilao.lance_minimo) {
    throw new Error(`Lance insuficiente. Mínimo: ${Math.max(leilao.lance_atual + 1, leilao.lance_minimo)}`);
  }
  if (!temSaldo(jogador_id, { [leilao.moeda]: valor })) {
    throw new Error(`Saldo insuficiente para o lance de ${valor} ${leilao.moeda}.`);
  }

  db.prepare(`
    UPDATE leiloes SET lance_atual = ?, maior_licitante = ?
    WHERE id = ?
  `).run(valor, jogador_id, leilao_id);

  db.prepare(`
    INSERT INTO lances_leilao (leilao_id, jogador_id, valor, moeda)
    VALUES (?, ?, ?, ?)
  `).run(leilao_id, jogador_id, valor, leilao.moeda);

  return { leilao_id, valor, moeda: leilao.moeda };
}

/**
 * Encerra leilões expirados e processa pagamentos.
 */
export function encerrarLeiloes() {
  const agora = new Date().toISOString();
  const vencidos = db.prepare(`
    SELECT * FROM leiloes WHERE status = 'ativo' AND encerra_em < ?
  `).all(agora);

  const encerrados = [];

  for (const leilao of vencidos) {
    if (leilao.maior_licitante && leilao.lance_atual > 0) {
      // Debita do vencedor
      modificarCarteira(leilao.maior_licitante, { [leilao.moeda]: -leilao.lance_atual });

      // Entrega o item
      const itemNoInv = db.prepare(`
        SELECT * FROM inventario WHERE jogador_id = ? AND item_id = ?
      `).get(leilao.maior_licitante, leilao.item_id);

      if (itemNoInv) {
        db.prepare("UPDATE inventario SET quantidade = quantidade + 1 WHERE id = ?").run(itemNoInv.id);
      } else {
        db.prepare("INSERT INTO inventario (jogador_id, item_id, quantidade) VALUES (?, ?, 1)")
          .run(leilao.maior_licitante, leilao.item_id);
      }

      // Credita ao vendedor
      if (leilao.vendedor_id) {
        modificarCarteira(leilao.vendedor_id, { [leilao.moeda]: leilao.lance_atual });
      }

      encerrados.push({ leilao_id: leilao.id, vencedor: leilao.maior_licitante, valor: leilao.lance_atual });
    }

    db.prepare("UPDATE leiloes SET status = 'encerrado' WHERE id = ?").run(leilao.id);
  }

  return encerrados;
}

/**
 * Retorna leilões ativos.
 */
export function getLeiloesAtivos() {
  return db.prepare(`
    SELECT l.*, it.nome as item_nome, it.tipo as item_tipo, it.raridade
    FROM leiloes l
    JOIN itens it ON l.item_id = it.id
    WHERE l.status = 'ativo'
    ORDER BY l.encerra_em ASC
  `).all();
}

// ==========================================
// HISTÓRICO E ESTATÍSTICAS
// ==========================================

/**
 * Retorna o histórico de transações do jogador.
 */
export function getHistoricoTransacoes(jogador_id, limit = 20) {
  return db.prepare(`
    SELECT t.*, it.nome as item_nome, l.nome as loja_nome
    FROM transacoes t
    LEFT JOIN itens it ON t.item_id = it.id
    LEFT JOIN lojas l ON t.loja_id = l.id
    WHERE t.jogador_id = ?
    ORDER BY t.timestamp DESC
    LIMIT ?
  `).all(jogador_id, limit);
}

/**
 * Retorna estatísticas econômicas gerais.
 */
export function getEstatisticasEconomia() {
  const estado = getFullWorldState();
  const transacoes = db.prepare(`
    SELECT
      SUM(ouro) as ouro_total,
      SUM(creditos) as creditos_total,
      COUNT(*) as total_transacoes
    FROM transacoes
  `).get();

  return {
    moeda: { ouro: transacoes.ouro_total || 0, creditos: transacoes.creditos_total || 0 },
    total_transacoes: transacoes.total_transacoes,
    modificadores_ativos: {
      quasiluz: estado.nivel_quasiluz >= 60 ? "Alta — implantes +30%" : "Normal",
      irmandade: estado.poder_irmandade >= 70 ? "Forte — armas +50%" : "Normal",
      vacuo: estado.influencia_vacuo >= 40 ? "Ativo — artefatos +100%" : "Inativo",
    },
  };
}
// ==========================================
// ECONOMY ENGINE — VEXON (PARTE 2 DE 2)
// Mercado negro, sistema de favor, eventos de preço e rotas
// ==========================================


// ==========================================
// SISTEMA DE FAVOR — MOEDA DE INFLUÊNCIA
// ==========================================

/**
 * Favor é ganho ajudando facções, NPCs, completando quests políticas.
 * É gasto para conseguir favores de volta: acesso a áreas, informações secretas,
 * desconto em lojas de facção, liberdade de prisão.
 */
const CUSTOS_FAVOR = {
  acesso_area_restrita:    5,   // Entrar em área controlada por facção
  informacao_secreta:      10,  // Comprar informação de NPC informante
  liberacao_prisao:        20,  // Ser solto após ser capturado
  alianca_temporaria:      15,  // NPC luta ao seu lado por 1 combate
  desconto_especial:       8,   // 30% de desconto na próxima compra
  protecao_faccao:         25,  // Facção ignora uma transgressão sua
  introducao_npc_especial: 12,  // Ser apresentado a um NPC importante
};

/**
 * Gasta favor do jogador para um serviço.
 * Retorna o benefício obtido.
 */
export function gastarFavor(jogador_id, servico) {
  const custo = CUSTOS_FAVOR[servico];
  if (!custo) throw new Error(`Serviço desconhecido: "${servico}".`);

  if (!temSaldo(jogador_id, { favor: custo })) {
    const carteira = getCarteira(jogador_id);
    throw new Error(`Favor insuficiente. Tem: ${carteira.favor}, precisa: ${custo}.`);
  }

  modificarCarteira(jogador_id, { favor: -custo });

  const descricoesBeneficios = {
    acesso_area_restrita:    "Acesso garantido por 1 sessão.",
    informacao_secreta:      "Informação revelada pelo informante.",
    liberacao_prisao:        "Solto sem consequências desta vez.",
    alianca_temporaria:      "NPC lutará ao seu lado no próximo combate.",
    desconto_especial:       "30% de desconto na próxima compra em qualquer loja.",
    protecao_faccao:         "A facção fecha os olhos para uma transgressão.",
    introducao_npc_especial: "Apresentado a um contato de alto valor.",
  };

  db.prepare(`
    INSERT INTO transacoes (jogador_id, tipo, favor, descricao)
    VALUES (?, 'transferencia', ?, ?)
  `).run(jogador_id, -custo, `Favor gasto: ${servico}`);

  logWorldEvent("favor_gasto", `[Jogador ${jogador_id}] Favor gasto: ${servico}`, [jogador_id]);

  return {
    servico,
    custo,
    beneficio: descricoesBeneficios[servico],
  };
}

/**
 * Concede favor ao jogador por ação significativa.
 */
export function concederFavor(jogador_id, quantidade, motivo) {
  modificarCarteira(jogador_id, { favor: quantidade });
  db.prepare(`
    INSERT INTO transacoes (jogador_id, tipo, favor, descricao)
    VALUES (?, 'recompensa', ?, ?)
  `).run(jogador_id, quantidade, `Favor ganho: ${motivo}`);

  return { favor_ganho: quantidade, motivo };
}

// ==========================================
// MERCADO NEGRO — SOMBRA E BECOS
// ==========================================

/**
 * Gera uma oferta de mercado negro via IA.
 * O mercado negro tem itens únicos, ilegais ou escassos — e preços altos.
 *
 * @param {number} jogador_id
 * @param {number} reputacao_mercado - Reputação do jogador com o Mercado Negro (-100 a +100)
 */
export async function gerarOfertaMercadoNegro(jogador_id, reputacao_mercado = 0) {
  const player = getPlayer(jogador_id);
  const estado = getFullWorldState();
  const carteira = getCarteira(jogador_id);

  const nivelAcesso = reputacao_mercado >= 50 ? "alto" :
                      reputacao_mercado >= 0  ? "medio" : "baixo";

  const prompt = `Você é Sombra — o informante do mercado negro de Vexon.

Gere 3 itens únicos disponíveis HOJE no mercado negro.
Os itens devem ser raros, ilegais ou difíceis de encontrar.

Contexto:
- Jogador: ${player.nome} (Nível ${player.nivel})
- Nível de acesso no mercado negro: ${nivelAcesso}
- Ouro disponível: ${carteira.ouro} | Créditos: ${carteira.creditos}
- Estado do mundo: Irmandade ${estado.poder_irmandade}% | Quasiluz ${estado.nivel_quasiluz}%

Regra: acesso "baixo" = apenas itens comuns ilegais. "medio" = incomuns. "alto" = raros/muito_raros.

Responda APENAS com JSON válido:
{
  "ofertas": [
    {
      "nome": "Nome do item",
      "tipo": "arma|armadura|consumivel|cibernetico|artefato|ferramenta",
      "raridade": "comum|incomum|rara|muito_rara",
      "dano_ou_efeito": "efeito mecânico",
      "propriedades": "propriedades do item",
      "descricao": "1 frase imersiva em Vexon",
      "habilidade_tematica": "tema ou null",
      "peso": "X kg",
      "preco_ouro": número,
      "preco_creditos": número,
      "origem": "De onde veio este item"
    }
  ],
  "narração": "1 parágrafo de Sombra apresentando os itens, tom misterioso"
}`;

  try {
    const raw = await callOllamaWorld([
      { role: "system", content: "Você é Sombra. Responda APENAS com JSON válido." },
      { role: "user",   content: prompt },
    ], { num_predict: 500, temperature: 0.9 });

    const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
    const match   = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("JSON inválido.");

    const data = JSON.parse(match[0]);
    return {
      ofertas:  data.ofertas  || [],
      narracao: data.narração || data.narracao || "Sombra empurra uma pasta com os itens disponíveis.",
      acesso:   nivelAcesso,
    };
  } catch (err) {
    console.warn("[EconomyEngine] Mercado negro IA falhou:", err.message);
    return gerarOfertaMercadoNegroFallback(nivelAcesso);
  }
}

/**
 * Fallback sem IA para o mercado negro.
 */
function gerarOfertaMercadoNegroFallback(nivelAcesso) {
  const ofertas = {
    baixo: [
      {
        nome: "Veneno de Contato Básico",
        tipo: "consumivel",
        raridade: "comum",
        dano_ou_efeito: "1d4 veneno por 2 turnos",
        propriedades: "ilegal, consumível, aplicável em arma",
        descricao: "Extraído de insetos das ruínas. Eficaz, discreto.",
        habilidade_tematica: null,
        peso: "0.1 kg",
        preco_ouro: 80,
        preco_creditos: 0,
        origem: "Contrabandistas do setor sul",
      },
    ],
    medio: [
      {
        nome: "Chip de Acesso Corporativo Falsificado",
        tipo: "ferramenta",
        raridade: "incomum",
        dano_ou_efeito: "acesso a áreas corporativas nível 2",
        propriedades: "ilegal, eletrônico, uso único",
        descricao: "Parece autêntico. Por enquanto.",
        habilidade_tematica: "Cibernético",
        peso: "0 kg",
        preco_ouro: 0,
        preco_creditos: 150,
        origem: "Hackers do Coração Sombrio (vazamento)",
      },
    ],
    alto: [
      {
        nome: "Amostra de DNA Σ-Prime Concentrada",
        tipo: "consumivel",
        raridade: "rara",
        dano_ou_efeito: "modifica atributo aleatório permanentemente (risco alto)",
        propriedades: "ilegal, biológico, instável",
        descricao: "O que está dentro pode mudar você. Ou destruí-lo.",
        habilidade_tematica: "Bioenergético",
        peso: "0.1 kg",
        preco_ouro: 800,
        preco_creditos: 500,
        origem: "Laboratorios VarnCore selados",
      },
    ],
  };

  return {
    ofertas: ofertas[nivelAcesso] || ofertas.baixo,
    narracao: "Sombra desliza uma pasta pela mesa sem te olhar nos olhos.",
    acesso: nivelAcesso,
  };
}

// ==========================================
// EVENTOS DE PREÇO MUNDIAIS
// ==========================================

/**
 * Processa eventos econômicos baseados no estado do mundo.
 * Chamado pelo worldEngine tick.
 * Retorna eventos de preço que afetam o mercado.
 */
export function processarEventosEconomicos() {
  const estado = getFullWorldState();
  const eventos = [];

  // Quasiluz alta = implantes cibernéticos escassos
  if (estado.nivel_quasiluz >= 70) {
    eventos.push({
      titulo: "Escassez de Implantes",
      descricao: "Alta Quasiluz prejudica produção — implantes 40% mais caros.",
      modificador: 1.4,
      itens_afetados: ["cibernetico", "implante"],
    });
  }

  // Irmandade forte = armas controladas, preço sobe no mercado negro
  if (estado.poder_irmandade >= 75) {
    eventos.push({
      titulo: "Controle de Armas da Irmandade",
      descricao: "Irmandade confisca arsenais — armas 50% mais caras no mercado livre.",
      modificador: 1.5,
      itens_afetados: ["arma"],
    });
  }

  // Darvoss fraca = créditos corporativos perdem valor
  if (estado.poder_darvoss <= 25) {
    eventos.push({
      titulo: "Colapso do Crédito Darvoss",
      descricao: "Darvoss Dynamics em crise — créditos corporativos desvalorizados.",
      modificador: 0.6,
      itens_afetados: ["creditos"],
    });
  }

  // Resistência forte = consumíveis medicinais mais baratos (doações)
  if (estado.poder_resistencia >= 60) {
    eventos.push({
      titulo: "Distribuição da Resistência",
      descricao: "Resistência distribui suprimentos — consumíveis de cura 20% mais baratos.",
      modificador: 0.8,
      itens_afetados: ["consumivel", "cura", "pocao"],
    });
  }

  // Vácuo alto = artefatos mágicos raríssimos e caríssimos
  if (estado.influencia_vacuo >= 50) {
    eventos.push({
      titulo: "Demanda por Proteção Arcana",
      descricao: "Influência do Vácuo — artefatos de proteção em altíssima demanda.",
      modificador: 2.5,
      itens_afetados: ["artefato", "runa", "sigilo"],
    });
  }

  if (eventos.length > 0) {
    console.log(`[EconomyEngine] ${eventos.length} evento(s) econômico(s) processados.`);
  }

  return eventos;
}

// ==========================================
// TICKER ECONÔMICO
// ==========================================

let _economyTicker = null;

/**
 * Inicia o ticker econômico periódico.
 */
export function iniciarEconomyTicker() {
  if (_economyTicker) return;

  const intervalo = (Number(process.env.ECONOMY_TICK_SEGUNDOS) || 120) * 1000; // Default: 2 min

  console.log(`[EconomyEngine] Economy ticker iniciado — intervalo: ${intervalo / 1000}s`);

  _economyTicker = setInterval(() => {
    try {
      encerrarLeiloes();
      processarEventosEconomicos();
    } catch (err) {
      console.error("[EconomyEngine] Erro no ticker:", err.message);
    }
  }, intervalo);
}

/**
 * Para o ticker econômico.
 */
export function pararEconomyTicker() {
  if (_economyTicker) {
    clearInterval(_economyTicker);
    _economyTicker = null;
    console.log("[EconomyEngine] Economy ticker parado.");
  }
}

// ==========================================
// ROTAS HTTP
// ==========================================

export function setupEconomyRoutes(app) {
  // GET - Carteira do jogador
  app.get("/api/economy/carteira/:jogador_id", (req, res) => {
    const jogador_id = Number(req.params.jogador_id);
    try {
      const carteira = getCarteira(jogador_id);
      res.json({ sucesso: true, carteira });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // GET - Lojas disponíveis
  app.get("/api/economy/lojas", (req, res) => {
    const { tipo } = req.query;
    try {
      const lojas = getLojas(tipo || null);
      res.json({ sucesso: true, lojas });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // GET - Estoque de uma loja com preços dinâmicos
  app.get("/api/economy/loja/:loja_id/estoque", (req, res) => {
    const loja_id  = Number(req.params.loja_id);
    const jogador_id = Number(req.query.jogador_id) || null;
    try {
      const estoque = getEstoqueLoja(loja_id, jogador_id);
      res.json({ sucesso: true, estoque });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // POST - Comprar item
  app.post("/api/economy/comprar", (req, res) => {
    const { jogador_id, loja_id, item_id, quantidade = 1, moeda = "ouro" } = req.body;
    if (!jogador_id || !loja_id || !item_id) {
      return res.status(400).json({ sucesso: false, erro: "jogador_id, loja_id e item_id obrigatórios." });
    }
    try {
      const resultado = comprarItem(jogador_id, loja_id, item_id, quantidade, moeda);
      res.json({ sucesso: true, ...resultado });
    } catch (e) {
      res.status(400).json({ sucesso: false, erro: e.message });
    }
  });

  // POST - Vender item
  app.post("/api/economy/vender", (req, res) => {
    const { jogador_id, loja_id, item_id, quantidade = 1, moeda = "ouro" } = req.body;
    if (!jogador_id || !loja_id || !item_id) {
      return res.status(400).json({ sucesso: false, erro: "jogador_id, loja_id e item_id obrigatórios." });
    }
    try {
      const resultado = venderItem(jogador_id, loja_id, item_id, quantidade, moeda);
      res.json({ sucesso: true, ...resultado });
    } catch (e) {
      res.status(400).json({ sucesso: false, erro: e.message });
    }
  });

  // GET - Mercado negro (geração via IA)
  app.get("/api/economy/mercado-negro/:jogador_id", async (req, res) => {
    const jogador_id = Number(req.params.jogador_id);
    const reputacao  = Number(req.query.reputacao) || 0;
    try {
      const ofertas = await gerarOfertaMercadoNegro(jogador_id, reputacao);
      res.json({ sucesso: true, ...ofertas });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // GET - Leilões ativos
  app.get("/api/economy/leiloes", (_req, res) => {
    try {
      const leiloes = getLeiloesAtivos();
      res.json({ sucesso: true, leiloes });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // POST - Criar leilão
  app.post("/api/economy/leilao/criar", (req, res) => {
    const { item_id, lance_minimo, moeda = "ouro", duracao_minutos = 30, vendedor_id, vendedor_npc } = req.body;
    if (!item_id || !lance_minimo) {
      return res.status(400).json({ sucesso: false, erro: "item_id e lance_minimo obrigatórios." });
    }
    try {
      const leilao_id = criarLeilao(item_id, lance_minimo, moeda, duracao_minutos, vendedor_id, vendedor_npc);
      res.json({ sucesso: true, leilao_id });
    } catch (e) {
      res.status(400).json({ sucesso: false, erro: e.message });
    }
  });

  // POST - Dar lance em leilão
  app.post("/api/economy/leilao/:leilao_id/lance", (req, res) => {
    const leilao_id  = Number(req.params.leilao_id);
    const { jogador_id, valor } = req.body;
    if (!jogador_id || !valor) {
      return res.status(400).json({ sucesso: false, erro: "jogador_id e valor obrigatórios." });
    }
    try {
      const resultado = darLance(jogador_id, leilao_id, valor);
      res.json({ sucesso: true, ...resultado });
    } catch (e) {
      res.status(400).json({ sucesso: false, erro: e.message });
    }
  });

  // POST - Gastar favor
  app.post("/api/economy/favor/gastar", (req, res) => {
    const { jogador_id, servico } = req.body;
    if (!jogador_id || !servico) {
      return res.status(400).json({ sucesso: false, erro: "jogador_id e servico obrigatórios." });
    }
    try {
      const resultado = gastarFavor(jogador_id, servico);
      res.json({ sucesso: true, ...resultado });
    } catch (e) {
      res.status(400).json({ sucesso: false, erro: e.message });
    }
  });

  // GET - Histórico de transações
  app.get("/api/economy/historico/:jogador_id", (req, res) => {
    const jogador_id = Number(req.params.jogador_id);
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    try {
      const historico = getHistoricoTransacoes(jogador_id, limit);
      res.json({ sucesso: true, historico });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // GET - Estatísticas econômicas globais
  app.get("/api/economy/stats", (_req, res) => {
    try {
      const stats = getEstatisticasEconomia();
      res.json({ sucesso: true, ...stats });
    } catch (e) {
      res.status(500).json({ sucesso: false, erro: e.message });
    }
  });

  // GET - Converter moeda
  app.get("/api/economy/converter", (req, res) => {
    const { valor, de, para } = req.query;
    if (!valor || !de || !para) {
      return res.status(400).json({ sucesso: false, erro: "valor, de e para são obrigatórios." });
    }
    try {
      const resultado = converterMoeda(Number(valor), de, para);
      res.json({ sucesso: true, de, para, valor_original: Number(valor), valor_convertido: resultado, taxa: TAXA_CONVERSAO[`${de}_para_${para}`] });
    } catch (e) {
      res.status(400).json({ sucesso: false, erro: e.message });
    }
  });

  console.log("[EconomyEngine] Rotas registradas: /api/economy/*");
}