import dotenv from "dotenv";
dotenv.config();

import {
  insertPlayer,
  insertItem,
  insertMonster,
  insertNpc,
  insertLocation,
  addItemToInventory,
  equipWeapon,
  getPlayer,
  toJson,
} from "./db/database.js";
import { initializeNpcSoul } from "./ia/npcsoulEngine.js";

// ==========================================
// TEMPLATES DE PERSONAGENS
// ==========================================

const PERSONAGENS = {
  luca: {
    ficha: {
      nome:         "Luca",
      nivel:        1,
      xp:           0,
      hp_maximo:    20,
      hp_atual:     20,
      ca:           12,
      forca:        18,
      destreza:     14,
      resistencia:  14,
      inteligencia: 18,
      sabedoria:    12,
      carisma:      10,
      ouro:         500,
      deslocamento: "9m",
      objetivo:     "Descobrir a verdade sobre a Eclipsa",
      faccao:       "Nenhuma",
      inimigos:     toJson([]),
      aliados:      toJson([]),
      territorio:   "Cidade de Vexon",
      habilidades:  toJson([]),
    },
    equipamento: [
      {
        item: {
          nome:               "Kusarigama de Fóton",
          tipo:               "arma",
          raridade:           "rara",
          dano_ou_efeito:     "1d10",
          propriedades:       "pesado, letal, finesse",
          peso:               "2 kg",
          valor:              "250 po",
          descricao:          "Uma corrente letal banhada em energia sombria. Vibra levemente ao toque.",
          habilidade_tematica:"Sombras",
        },
        quantidade: 1,
        equipar:    true,
      },
      {
        item: {
          nome:               "Armadura de Couro Reforçado",
          tipo:               "armadura",
          raridade:           "comum",
          dano_ou_efeito:     null,
          propriedades:       "CA base 12, leve",
          peso:               "5 kg",
          valor:              "45 po",
          descricao:          "Couro curtido reforçado com placas metálicas nas juntas.",
          habilidade_tematica:null,
        },
        quantidade: 1,
        equipar:    false,
      },
      {
        item: {
          nome:               "Poção de Cura",
          tipo:               "consumivel",
          raridade:           "comum",
          dano_ou_efeito:     "1d8+4",
          propriedades:       "cura, consumível",
          peso:               "0.5 kg",
          valor:              "50 po",
          descricao:          "Um frasco de líquido rubro que acelera a regeneração celular.",
          habilidade_tematica:null,
        },
        quantidade: 3,
        equipar:    false,
      },
      {
        item: {
          nome:               "Kit de Ferramentas de Ladrão",
          tipo:               "ferramenta",
          raridade:           "comum",
          dano_ou_efeito:     null,
          propriedades:       "furtividade, arrombamento",
          peso:               "1 kg",
          valor:              "25 po",
          descricao:          "Gazuas, espelhos pequenos e ferramentas de precisão.",
          habilidade_tematica:null,
        },
        quantidade: 1,
        equipar:    false,
      },
    ],
  },
};

// ==========================================
// COMPÊNDIO INICIAL — MONSTROS
// ==========================================

const MONSTROS_INICIAIS = [
  {
    nome:                "Sentinela das Sombras",
    tamanho:             "Médio",
    tipo:                "humanoide",
    alinhamento:         "neutro maligno",
    deslocamento:        "9m",
    hp_maximo:           30,
    hp_atual:            30,
    ca:                  13,
    forca:               14,
    destreza:            12,
    resistencia:         12,
    inteligencia:        8,
    sabedoria:           10,
    carisma:             8,
    ouro:                20,
    nivel:               2,
    ameaca:              "1/2",
    objetivo:            "Patrulhar e eliminar intrusos",
    faccao:              "A Irmandade",
    relacao_com_jogador: "Agressivo",
    acoes:               toJson([{ nome: "Golpe de Lança", dano: "1d6+2", descricao: "Ataque corpo a corpo" }]),
    habilidades_passivas:toJson([{ nome: "Visão no Escuro", descricao: "Enxerga até 18m no escuro" }]),
    descricao:           "Guardião encurvado com olhos que brilham vermelho nas sombras.",
    memoria:             toJson([]),
    inimigos:            toJson([]),
    aliados:             toJson(["A Irmandade"]),
    territorio:          "Cidade de Vexon",
  },
  {
    nome:                "Cão das Ruínas",
    tamanho:             "Pequeno",
    tipo:                "besta",
    alinhamento:         "sem alinhamento",
    deslocamento:        "12m",
    hp_maximo:           11,
    hp_atual:            11,
    ca:                  12,
    forca:               12,
    destreza:            15,
    resistencia:         11,
    inteligencia:        3,
    sabedoria:           12,
    carisma:             6,
    ouro:                0,
    nivel:               1,
    ameaca:              "1/4",
    objetivo:            "Caçar e defender território",
    faccao:              "Nenhuma",
    relacao_com_jogador: "Agressivo",
    acoes:               toJson([{ nome: "Mordida", dano: "1d4+1", descricao: "Ataque corpo a corpo" }]),
    habilidades_passivas:toJson([{ nome: "Olfato Apurado", descricao: "Vantagem em percepção por cheiro" }]),
    descricao:           "Criatura canina com pelos enegrecidos e dentes ácidos, produto de mutação mágica.",
    memoria:             toJson([]),
    inimigos:            toJson([]),
    aliados:             toJson([]),
    territorio:          "Periferias de Vexon",
  },
  {
    nome:                "Arcanista Corrompido",
    tamanho:             "Médio",
    tipo:                "humanoide",
    alinhamento:         "caótico maligno",
    deslocamento:        "9m",
    hp_maximo:           52,
    hp_atual:            52,
    ca:                  12,
    forca:               9,
    destreza:            14,
    resistencia:         11,
    inteligencia:        17,
    sabedoria:           12,
    carisma:             11,
    ouro:                80,
    nivel:               5,
    ameaca:              "3",
    objetivo:            "Expandir o poder da Irmandade",
    faccao:              "A Irmandade",
    relacao_com_jogador: "Agressivo",
    acoes:               toJson([
      { nome: "Raio Arcano",    dano: "2d6", descricao: "Projétil mágico à distância (18m)" },
      { nome: "Rajada de Fogo", dano: "3d6", descricao: "Cone de 4,5m — teste de Des CD 13 para metade" },
    ]),
    habilidades_passivas:toJson([{ nome: "Resistência Mágica", descricao: "Vantagem em salvaguardas contra magia" }]),
    descricao:           "Mago de manto negro, olhos completamente brancos. Veias luminescentes percorrem seu rosto.",
    memoria:             toJson([]),
    inimigos:            toJson([]),
    aliados:             toJson(["A Irmandade"]),
    territorio:          "Torre da Eclipsa",
  },
];

// ==========================================
// COMPÊNDIO INICIAL — NPCs
// ==========================================

const NPCS_INICIAIS = [
  {
    nome:                "Mira, a Ferreira",
    tamanho:             "Médio",
    tipo:                "humanoide",
    alinhamento:         "neutro bom",
    nivel_social:        "plebeu",
    arquetipo:           "comerciante",
    deslocamento:        "9m",
    ca:                  10,
    hp:                  12,
    forca:               14,
    destreza:            10,
    resistencia:         14,
    inteligencia:        12,
    sabedoria:           13,
    carisma:             11,
    ouro:                800,
    nivel:               3,
    idiomas:             "Comum, Anão",
    personalidade:       "Direta, honesta e desconfiada de estranhos. Amolece com quem demonstra respeito.",
    objetivo:            "Manter a forja funcionando e proteger seu filho",
    faccao:              "Cidadãos de Vexon",
    relacao_com_jogador: "Desconhecido",
    influencia:          2,
    tendencia:           "neutro bom",
    descricao:           "Mulher robusta de meia-idade, mãos calejadas e avental de couro chamuscado.",
    acoes:               toJson([{ nome: "Martelada", dano: "1d6+2", descricao: "Só se ameaçada" }]),
    habilidades_passivas:toJson([{ nome: "Avaliação de Metal", descricao: "Identifica qualidade de armas e armaduras instantaneamente" }]),
    memoria:             toJson([]),
    inimigos:            toJson([]),
    aliados:             toJson([]),
    territorio:          "Distrito Industrial de Vexon",
  },
  {
    nome:                "Sombra",
    tamanho:             "Médio",
    tipo:                "humanoide",
    alinhamento:         "caótico neutro",
    nivel_social:        "criminoso",
    arquetipo:           "informante",
    deslocamento:        "9m",
    ca:                  14,
    hp:                  22,
    forca:               10,
    destreza:            16,
    resistencia:         12,
    inteligencia:        14,
    sabedoria:           13,
    carisma:             15,
    ouro:                200,
    nivel:               4,
    idiomas:             "Comum, Élfico, Gíria dos Becos",
    personalidade:       "Enigmático, sempre calculando. Vende informação para qualquer lado mas tem seu próprio código de honra.",
    objetivo:            "Acumular poder e informação suficiente para abandonar Vexon",
    faccao:              "Mercado Negro",
    relacao_com_jogador: "Desconhecido",
    influencia:          6,
    tendencia:           "caótico neutro",
    descricao:           "Figura encoberta que nunca mostra o rosto completamente. Sempre encostado em paredes.",
    acoes:               toJson([{ nome: "Adaga", dano: "1d4+3", descricao: "Ataque rápido corpo a corpo" }]),
    habilidades_passivas:toJson([
      { nome: "Furtividade Urbana", descricao: "Vantagem em furtividade em ambientes urbanos" },
      { nome: "Rede de Contatos",   descricao: "Sabe de tudo que acontece na cidade em 24h" },
    ]),
    memoria:             toJson([]),
    inimigos:            toJson([]),
    aliados:             toJson(["Mercado Negro"]),
    territorio:          "Becos de Vexon",
  },
];

// ==========================================
// NPCs DE LORE — FIGURAS IMPORTANTES DO UNIVERSO VEXON
// Fonte: ReadmeIAmestre.txt, seção 5 (Figuras de Lore) + equipe de apoio.
// ==========================================

const NPCS_LORE_INICIAIS = [
  {
    nome:                "Darian Varkos",
    classe:              "herdeiro_tatico",
    tamanho:             "Médio",
    tipo:                "humanoide",
    alinhamento:         "leal bom",
    nivel_social:        "lider",
    arquetipo:           "vigilante",
    deslocamento:        "9m",
    ca:                  10,
    hp:                  10,
    forca:               13,
    destreza:            16,
    resistencia:         12,
    inteligencia:        14,
    sabedoria:           12,
    carisma:             13,
    ouro:                5000,
    nivel:               6,
    idiomas:             "Comum",
    personalidade:       "Bilionário de dia, vigilante furtivo, letal e estrategista de noite. Veste armadura sombria.",
    objetivo:            "Destruir A Irmandade e libertar Vexon",
    faccao:              "VarnX Core",
    relacao_com_jogador: "Desconhecido",
    influencia:          9,
    tendencia:           "leal bom",
    descricao:           "Conhecido nas sombras como 'Noctark'. Opera a partir da VarnX Core e do bunker Coração Sombrio.",
    acoes:               toJson([{ nome: "Ataque Furtivo", dano: "1d8+3", descricao: "Golpe rápido nas sombras" }]),
    habilidades_passivas:toJson([{ nome: "Visão Tática", descricao: "Marca um alvo e revela seus pontos fracos" }]),
    memoria:             toJson([]),
    inimigos:            toJson(["A Irmandade", "Darvoss Dynamics"]),
    aliados:             toJson(["VarnX Core"]),
    territorio:          "Coração Sombrio",
  },
  {
    nome:                "Elyara Varn",
    classe:              "anomalia_bioenergetica",
    tamanho:             "Médio",
    tipo:                "humanoide",
    alinhamento:         "neutro bom",
    nivel_social:        "influente",
    arquetipo:           "jornalista",
    deslocamento:        "9m",
    ca:                  10,
    hp:                  8,
    forca:               8,
    destreza:            12,
    resistencia:         13,
    inteligencia:        13,
    sabedoria:           12,
    carisma:             16,
    ouro:                300,
    nivel:               5,
    idiomas:             "Comum",
    personalidade:       "Jornalista e cobaia do Projeto Senthros Alpha. Símbolo de esperança para os oprimidos de Vexon.",
    objetivo:            "Expor a verdade sobre a Darvoss Dynamics e o Protocolo Noite Vermelha",
    faccao:              "Nenhuma",
    relacao_com_jogador: "Desconhecido",
    influencia:          7,
    tendencia:           "neutro bom",
    descricao:           "Conhecida como 'Senthros'. Um ser de bioenergia pura que manipula Quasiluz, instável mas luminoso.",
    acoes:               toJson([{ nome: "Pulso de Quasiluz", dano: "1d10", descricao: "Disparo de energia condensada" }]),
    habilidades_passivas:toJson([{ nome: "Instabilidade Bioenergética", descricao: "Pode disparar luz e voar, mas arrisca perder o controle" }]),
    memoria:             toJson([]),
    inimigos:            toJson(["Darvoss Dynamics"]),
    aliados:             toJson([]),
    territorio:          "Vexon City",
  },
  {
    nome:                "Nireva Nocturne",
    classe:              "ilusionista_das_sombras",
    tamanho:             "Médio",
    tipo:                "humanoide",
    alinhamento:         "leal neutro",
    nivel_social:        "lider",
    arquetipo:           "mago",
    deslocamento:        "9m",
    ca:                  13,
    hp:                  16,
    forca:               8,
    destreza:            15,
    resistencia:         12,
    inteligencia:        16,
    sabedoria:           13,
    carisma:             14,
    ouro:                600,
    nivel:               5,
    idiomas:             "Comum, Élfico",
    personalidade:       "Ilusionista de Nova Varnhold, portadora do perigoso e consciente Grimório de Umbros. Controla as sombras.",
    objetivo:            "Proteger o Grimório de Umbros e impedir a profanação mágica",
    faccao:              "Ordem dos Sussurradores",
    relacao_com_jogador: "Desconhecido",
    influencia:          8,
    tendencia:           "leal neutro",
    descricao:           "Conhecida como 'Eclipsa'. Última linha de defesa da magia real em Nova Varnhold.",
    acoes:               toJson([{ nome: "Lâmina de Sombra", dano: "1d8", descricao: "Corte de energia sombria" }]),
    habilidades_passivas:toJson([{ nome: "Grimório Consciente", descricao: "O Grimório de Umbros sussurra segredos e resiste a ser corrompido" }]),
    memoria:             toJson([]),
    inimigos:            toJson(["O Vácuo"]),
    aliados:             toJson(["Ordem dos Sussurradores", "VarnX Core"]),
    territorio:          "Nova Varnhold",
  },
  {
    nome:                "Aline Ventris",
    tamanho:             "Médio",
    tipo:                "humanoide",
    alinhamento:         "leal bom",
    nivel_social:        "influente",
    arquetipo:           "politico",
    deslocamento:        "9m",
    ca:                  10,
    hp:                  8,
    forca:               8,
    destreza:            10,
    resistencia:         10,
    inteligencia:        15,
    sabedoria:           13,
    carisma:             16,
    ouro:                1200,
    nivel:               3,
    idiomas:             "Comum",
    personalidade:       "Política e estrategista da equipe de apoio de Darian Varkos, infiltrada no meio corporativo.",
    objetivo:            "Bloquear a influência política da Darvoss Dynamics",
    faccao:              "VarnX Core",
    relacao_com_jogador: "Desconhecido",
    influencia:          6,
    tendencia:           "leal bom",
    descricao:           "Executiva de fachada impecável, mas cada decisão política dela mina a Darvoss por dentro.",
    acoes:               toJson([]),
    habilidades_passivas:toJson([{ nome: "Influência Corporativa", descricao: "Acesso e credibilidade dentro do mundo corporativo" }]),
    memoria:             toJson([]),
    inimigos:            toJson(["Darvoss Dynamics"]),
    aliados:             toJson(["VarnX Core"]),
    territorio:          "Vexon City",
  },
  {
    nome:                "Kai Solano",
    classe:              "hacker_corporativo",
    tamanho:             "Médio",
    tipo:                "humanoide",
    alinhamento:         "caótico bom",
    nivel_social:        "influente",
    arquetipo:           "hacker",
    deslocamento:        "9m",
    ca:                  12,
    hp:                  4,
    forca:               8,
    destreza:            13,
    resistencia:         10,
    inteligencia:        17,
    sabedoria:           14,
    carisma:             10,
    ouro:                400,
    nivel:               4,
    idiomas:             "Comum",
    personalidade:       "Hacker caótico da equipe de apoio de Darian Varkos. Opera a IA LYNX.",
    objetivo:            "Rastrear e sabotar a Darvoss Dynamics por dentro da rede",
    faccao:              "VarnX Core",
    relacao_com_jogador: "Desconhecido",
    influencia:          4,
    tendencia:           "caótico bom",
    descricao:           "Raramente sai do subsolo da VarnX Core. LYNX, sua IA, é sua voz para o mundo exterior.",
    acoes:               toJson([]),
    habilidades_passivas:toJson([{ nome: "LYNX", descricao: "IA parceira que rastreia movimentações suspeitas em tempo real" }]),
    memoria:             toJson([]),
    inimigos:            toJson(["Darvoss Dynamics"]),
    aliados:             toJson(["VarnX Core"]),
    territorio:          "Coração Sombrio",
  },
  {
    nome:                "Elin Mirae",
    tamanho:             "Médio",
    tipo:                "humanoide",
    alinhamento:         "neutro bom",
    nivel_social:        "influente",
    arquetipo:           "medica",
    deslocamento:        "9m",
    ca:                  10,
    hp:                  9,
    forca:               8,
    destreza:            10,
    resistencia:         12,
    inteligencia:        16,
    sabedoria:           15,
    carisma:             11,
    ouro:                350,
    nivel:               4,
    idiomas:             "Comum",
    personalidade:       "Médica e neurocientista da equipe de apoio de Darian Varkos. Coordena operações táticas do Coração Sombrio.",
    objetivo:            "Detectar e conter anomalias bioenergéticas antes que a Darvoss as explore",
    faccao:              "VarnX Core",
    relacao_com_jogador: "Desconhecido",
    influencia:          5,
    tendencia:           "neutro bom",
    descricao:           "Trabalha em turnos intermináveis monitorando sinais bioenergéticos em toda Vexon.",
    acoes:               toJson([]),
    habilidades_passivas:toJson([{ nome: "Diagnóstico Bioenergético", descricao: "Detecta anomalias de energia viva à distância" }]),
    memoria:             toJson([]),
    inimigos:            toJson([]),
    aliados:             toJson(["VarnX Core"]),
    territorio:          "Coração Sombrio",
  },
  {
    nome:                "Juno Karse",
    tamanho:             "Médio",
    tipo:                "humanoide",
    alinhamento:         "leal bom",
    nivel_social:        "influente",
    arquetipo:           "guarda",
    deslocamento:        "9m",
    ca:                  13,
    hp:                  15,
    forca:               13,
    destreza:            13,
    resistencia:         13,
    inteligencia:        11,
    sabedoria:           14,
    carisma:             12,
    ouro:                250,
    nivel:               4,
    idiomas:             "Comum",
    personalidade:       "Comissária de Segurança Pública, corajosa, investiga desaparecimentos por conta própria, arriscando a carreira.",
    objetivo:            "Descobrir quem, na hierarquia, está encobrindo o Projeto Genesis",
    faccao:              "VarnX Core",
    relacao_com_jogador: "Desconhecido",
    influencia:          5,
    tendencia:           "leal bom",
    descricao:           "Farda impecável, olhar cansado. Sabe que alguém acima dela está envolvido — e não vai parar.",
    acoes:               toJson([{ nome: "Arma de Serviço", dano: "1d8", descricao: "Disparo à distância" }]),
    habilidades_passivas:toJson([{ nome: "Instinto de Investigadora", descricao: "Percebe inconsistências e mentiras com facilidade" }]),
    memoria:             toJson([]),
    inimigos:            toJson(["Darvoss Dynamics"]),
    aliados:             toJson(["VarnX Core"]),
    territorio:          "Vexon City",
  },
];

// ==========================================
// LOCALIZAÇÕES INICIAIS
// ==========================================

const LOCALIZACOES_INICIAIS = [
  {
    nome:              "Cidade de Vexon — Centro",
    tipo:              "cidade",
    descricao:         "Coração da cidade sombria de Vexon. Ruas de paralelepípedos cobertos de névoa permanente. Lampiões de cristal arcano iluminam fracamente as calçadas. Edifícios de pedra negra dominam o skyline.",
    locais_conectados: toJson([]),
    npcs_fixos:        toJson(["Mira, a Ferreira", "Sombra"]),
    itens_locais:      toJson([]),
    perigo:            2,
  },
  {
    nome:              "Ruínas da Periferia",
    tipo:              "dungeon",
    descricao:         "Estruturas colapsadas na borda da cidade. Pilastras caídas, chão rachado por raízes de cristal negro. Cheiro de enxofre e metal queimado. Sons distantes de algo se arrastando.",
    locais_conectados: toJson([]),
    npcs_fixos:        toJson([]),
    itens_locais:      toJson([]),
    perigo:            6,
  },
  {
    nome:              "Torre da Eclipsa",
    tipo:              "dungeon",
    descricao:         "Torre de obsidiana que rasga as nuvens. Janelas que brilham com luz roxa. Guardas em cada andar. Lugar de poder — e de terror — para os habitantes de Vexon.",
    locais_conectados: toJson([]),
    npcs_fixos:        toJson([]),
    itens_locais:      toJson([]),
    perigo:            9,
  },
];

// ==========================================
// FUNÇÕES DE CRIAÇÃO
// ==========================================

export function criarPersonagem(chave) {
  const template = PERSONAGENS[chave];
  if (!template) throw new Error(`Personagem "${chave}" não encontrado nos templates.`);

  console.log(`\n[+] Criando personagem: ${template.ficha.nome}...`);

  const pResult   = insertPlayer(template.ficha);
  const jogadorId = pResult.lastInsertRowid;
  console.log(`    ✓ Ficha criada — ID: ${jogadorId}`);

  for (const entrada of template.equipamento) {
    const itemResult = insertItem(entrada.item);
    const itemId     = itemResult.lastInsertRowid;
    const invResult  = addItemToInventory(jogadorId, itemId, entrada.quantidade);

    if (entrada.equipar) {
      equipWeapon(jogadorId, invResult.lastInsertRowid);
      console.log(`    ✓ Item criado e equipado: ${entrada.item.nome}`);
    } else {
      console.log(`    ✓ Item adicionado ao inventário: ${entrada.item.nome} (x${entrada.quantidade})`);
    }
  }

  return jogadorId;
}

// criarCompendio agora é async para aguardar a geração das almas via Ollama
// semAlma=true pula a geração de alma via IA (mais rápido, usa apenas ALMA_BASE_PADRAO)
export async function criarCompendio(semAlma = false) {
  console.log("\n[+] Populando compêndio de monstros...");
  for (const monstro of MONSTROS_INICIAIS) {
    const r = insertMonster(monstro);
    console.log(`    ✓ Monstro: ${monstro.nome} (ID: ${r.lastInsertRowid})`);
  }

  console.log("\n[+] Populando compêndio de NPCs...");
  for (const npc of [...NPCS_INICIAIS, ...NPCS_LORE_INICIAIS]) {
    const r     = insertNpc(npc);
    const npcId = r.lastInsertRowid;
    console.log(`    ✓ NPC: ${npc.nome} (ID: ${npcId})`);

    if (semAlma) continue;

    // Gera a alma emocional de cada NPC via Ollama
    // usar_ia = true → Ollama gera trauma, medo e ambição únicos para cada personagem
    // Se o Ollama estiver offline, cai silenciosamente para valores padrão
    try {
      console.log(`    · Gerando alma de "${npc.nome}"...`);
      const alma = await initializeNpcSoul(npcId, "npcs", true);
      console.log(`      ✓ trauma="${alma.trauma_origem ?? "—"}" | medo="${alma.medo_primitivo ?? "—"}" | código="${alma.codigo_moral}"`);
    } catch (err) {
      console.warn(`      ⚠ Alma de "${npc.nome}" usou padrão (${err.message})`);
    }
  }

  console.log("\n[+] Criando localizações do mundo...");
  for (const loc of LOCALIZACOES_INICIAIS) {
    const r = insertLocation(loc);
    console.log(`    ✓ Local: ${loc.nome} (ID: ${r.lastInsertRowid})`);
  }
}

function exibirResumo(jogadorId) {
  const player = getPlayer(jogadorId);
  if (!player) return;

  console.log("\n" + "═".repeat(50));
  console.log("  PERFIL CRIADO COM SUCESSO");
  console.log("═".repeat(50));
  console.log(`  Nome:     ${player.nome}`);
  console.log(`  Nível:    ${player.nivel}`);
  console.log(`  HP:       ${player.hp_atual}/${player.hp_maximo}`);
  console.log(`  CA:       ${player.ca}`);
  console.log(`  Atributos:`);
  console.log(`    FOR ${player.forca}  DES ${player.destreza}  RES ${player.resistencia}`);
  console.log(`    INT ${player.inteligencia}  SAB ${player.sabedoria}  CAR ${player.carisma}`);
  console.log(`  Ouro:     ${player.ouro} po`);
  console.log("═".repeat(50));
  console.log(`\n  ► ID do Jogador: ${jogadorId}`);
  console.log(`  ► Guarde esse ID! Use nas chamadas da API.`);
  console.log("═".repeat(50) + "\n");
}

// ==========================================
// EXECUÇÃO PRINCIPAL
// ==========================================

// Só executa a CLI quando o arquivo é rodado diretamente (`node createProfile.js`),
// não quando é importado por outro módulo (ex.: bootstrap automático em server.js).
const isMain = process.argv[1] &&
  import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`;

if (isMain) {
  const args           = process.argv.slice(2);
  const apenasComp     = args.includes("--apenas-compendio");
  const semAlma        = args.includes("--sem-alma");        // pula geração de alma (mais rápido)
  const nomePersonagem = args.find(a => !a.startsWith("--")) ?? "luca";

  console.log("═".repeat(50));
  console.log("  VEXON — SISTEMA DE CRIAÇÃO DE PERFIL");
  console.log("═".repeat(50));
  if (semAlma) console.log("  ⚡ Modo rápido: geração de alma desativada\n");

  // Tudo é async agora por causa do initializeNpcSoul
  (async () => {
    try {
      if (!apenasComp) {
        const jogadorId = criarPersonagem(nomePersonagem);
        await criarCompendio(semAlma);
        exibirResumo(jogadorId);
      } else {
        await criarCompendio(semAlma);
        console.log("\n✓ Compêndio populado. Nenhum jogador criado.\n");
      }
    } catch (error) {
      console.error("\n[ERRO] Falha ao criar perfil:");
      console.error(error.message);

      if (error.message?.includes("UNIQUE constraint")) {
        console.error("\n  ► Dica: Este personagem já existe no banco.");
        console.error("  ► Delete o arquivo vexon.db e rode novamente para recomeçar.");
      }

      process.exit(1);
    }
  })();
}