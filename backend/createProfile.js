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
          descricao:          "Uma corrente letal banhada na energia sombria da Eclipsa. Vibra levemente ao toque.",
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
    faccao:              "Eclipsa",
    relacao_com_jogador: "Agressivo",
    acoes:               toJson([{ nome: "Golpe de Lança", dano: "1d6+2", descricao: "Ataque corpo a corpo" }]),
    habilidades_passivas:toJson([{ nome: "Visão no Escuro", descricao: "Enxerga até 18m no escuro" }]),
    descricao:           "Guardião encurvado com olhos que brilham vermelho nas sombras.",
    memoria:             toJson([]),
    inimigos:            toJson([]),
    aliados:             toJson(["Eclipsa"]),
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
    objetivo:            "Expandir o poder da Eclipsa",
    faccao:              "Eclipsa",
    relacao_com_jogador: "Agressivo",
    acoes:               toJson([
      { nome: "Raio Arcano",    dano: "2d6", descricao: "Projétil mágico à distância (18m)" },
      { nome: "Rajada de Fogo", dano: "3d6", descricao: "Cone de 4,5m — teste de Des CD 13 para metade" },
    ]),
    habilidades_passivas:toJson([{ nome: "Resistência Mágica", descricao: "Vantagem em salvaguardas contra magia" }]),
    descricao:           "Mago de manto negro, olhos completamente brancos. Veias luminescentes percorrem seu rosto.",
    memoria:             toJson([]),
    inimigos:            toJson([]),
    aliados:             toJson(["Eclipsa"]),
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
  for (const npc of NPCS_INICIAIS) {
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