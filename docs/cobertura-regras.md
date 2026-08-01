# Cobertura de Regras — Readme.txt vs. Implementação

Auditoria de quanto das regras de `Readme.txt` (livro do jogador) estão de fato implementadas no motor, feita comparando o texto do livro com `backend/classData.js`, `backend/engine/combatEngine.js`, `backend/engine/entityTurn.js`, `backend/engine/restEngine.js`, `backend/engine/deathEngine.js`, `backend/engine/skillEngine.js`, `backend/engine/gameEngine.js` e `backend/ia/intentClassifier.js`.

Legenda: ✅ Implementado · 🟡 Parcial · ❌ Ausente

## Mecânicas gerais

| Mecânica | Status | Arquivo:Função | Observação |
|---|---|---|---|
| Descanso Curto (gastar Dados de Vida, `1d{dado_vida}` + mod. Resistência por dado, limite = nível) | ✅ | `backend/engine/restEngine.js:descansoCurto` | Bloqueia com inimigos por perto; respeita o limite de Dados de Vida disponíveis. |
| Descanso Longo (HP total, zera Dados de Vida gastos, 1x/24h) | ✅ | `backend/engine/restEngine.js:descansoLongo` | Limite de 24h reais via `ultimo_descanso_longo`. **Não implementado**: "interrupções violentas cancelam o descanso" (combate >1h reiniciando o descanso do zero) — não há conceito de duração de descanso em andamento no motor. |
| Recuperação de recursos de classe (PS/PU/PE/PA/FV) no Descanso Curto/Longo | ❌ | — | Depende dos pontos de recurso por classe (tabela abaixo), que não existem no código. |
| Teste contra a Morte (d20 puro, 10+ sucesso, 9- falha, 1 nat. = 2 falhas, 20 nat. = revive com 1 HP, 3 sucessos estabiliza, 3 falhas mata) | ✅ | `backend/engine/deathEngine.js:rollDeathSave` | Rodado automaticamente a cada ação enquanto `status === 'inconsciente'`, via `gameEngine.js:processPlayerAction`. |
| Dano a 0 HP conta como falha automática (crítico = 2 falhas) | ✅ | `backend/engine/deathEngine.js:aplicarDanoEm0HP`, hook em `entityTurn.js:executarAtaque` | Espelhado (código secundário, não usado no caminho real) em `combatEngine.js:entityAttacksPlayer`. |
| Estabilizar aliado caído (teste de Inteligência/Medicina CD 10) | ✅ | `backend/engine/deathEngine.js:estabilizarAliado` | Alvo é um NPC/monstro em `entidades_vivas` com `status = 'inconsciente'`. Hoje nada no jogo normal coloca uma entidade nesse estado (monstros comuns sempre morrem a 0 HP) — a ação funciona, mas só tem alvo válido se algo (quest, evento Nemesis, criação manual via `/api/entity` + ajuste direto de status) colocar um NPC nesse estado. Não é uma lacuna desta tarefa — é a peça de infraestrutura (`updateActiveEntityHP` aceitando `statusOverride: 'inconsciente'`) que abre a porta para isso no futuro. |
| Teste de perícia (d20 + atributo + proficiência, CD definida pelo Mestre) | ✅ | `backend/engine/gameEngine.js:handleTeste`, `backend/ia/intentClassifier.js:resolverManobra`/`classificarComOllama` | Antes desta tarefa o intent `"teste"` não tinha chave em `INTENT_KEYWORDS` e `handleTeste` era código morto — qualquer ação ambígua ("eu tento escalar o muro") caía direto em narração livre sem nenhuma resolução mecânica. Agora, quando a classificação local por palavra-chave devolve `"livre"`, um fallback via Ollama (`classificarComOllama`) só decide *se* é um teste; a CD e o atributo vêm sempre de `resolverManobra` (tabela `MANOBRAS`, determinística) — a IA nunca define o número, conforme `docs/contracts.md`. Sem falar com o Ollama, ações de combate/magia/diálogo/etc. continuam 100% via regex local, sem custo de latência extra. **Gap conhecido**: `resolverManobra` devolve um atributo puro (ex. `"destreza"`), não o nome da perícia (ex. `"furtividade"`) — então o bônus fixo de perícia por classe (linha abaixo) ainda não é aplicado nesse caminho específico, só quando `rollD20Test` é chamado diretamente com o nome da perícia. |
| Perícias oficiais (14 perícias do livro: Atletismo, Acrobacia, Furtividade, Prestidigitação, Investigação, Medicina, Tecnologia, História, Percepção, Intuição, Sobrevivência, Intimidação, Persuasão, Enganação) e perícias iniciais por classe | ✅ | `backend/engine/skillEngine.js:PERICIAS`, `getBonusClassePericia`; `backend/classData.js:pericias_iniciais` | Lista corrigida para as 14 perícias oficiais (removidas `arcana`/`natureza`/`religiao`/`atuacao`/`adestramento`/`resistencia_veneno`/`concentracao`, que eram D&D 5e puro e não existem no Vexon; adicionada `tecnologia`, que faltava). **Bug corrigido**: `medicina` estava mapeada para `sabedoria`; o livro rege Medicina por Inteligência — corrigido. `pericias_iniciais` (bônus fixo +3/+2/+1, independente de nível) agora modelado nas 12 classes em `classData.js` e somado por `rollD20Test` via `getBonusClassePericia`, como campo `bonus_classe` separado de `bonus_proficiencia` (que continua sendo o bônus por nível do D&D, inalterado). **Desperto Vex**: o livro dá Atletismo/Acrobacia/Percepção em +3/+2/+1, mas a ordem depende do Traço Mutante escolhido na criação, que segue como flavor não mecanizado — usei essa mesma ordem (Atletismo+3/Acrobacia+2/Percepção+1) como decisão de design documentada em comentário no código, não uma regra extraída do livro; revisar quando/se o Traço Mutante virar mecânica real. Ver gap de integração com `resolverManobra` na linha acima. |
| Condições (Amedrontado, Atordoado, Caído, Cego, Invisível, Paralisado, Silenciado) | ❌ | — | Nenhum campo de condição em jogador/entidade, nenhum mecanismo de Vantagem/Desvantagem no motor de combate (`calculateAttack`/`executarAtaque` são um `d20 + mod` direto). |
| Subclasses (todas as 12 classes se especializam no Nível 3, "Despertar"/forma final no Nível 5-7) | ❌ | — | `classData.js` modela só o Nível 1 (comentário no próprio arquivo confirma isso). Nenhuma lógica de nível/branching de subclasse existe. |

## Pontos de recurso por classe

Nenhum dos pontos abaixo existe em `classData.js` nem é lido/gravado em `combatEngine.js`/`entityTurn.js`. `classData.js` só modela, por classe: `dado_vida` (nível 1), `ca_formula`, `ataque_assinatura` (nível 1), `bonus_dano_dado`/`bonus_dano_tipo` (nível 1, sem escala por nível).

| Classe | Recurso (Readme.txt) | Status |
|---|---|---|
| Herdeiro Tático | Dano Furtivo escalado por nível (não é pool de pontos) | 🟡 só o dado fixo de nível 1 (`bonus_dano_dado: "1d6"`), sem escala (2d6 no nv3, 5d6 no nv9...) |
| Anomalia Bioenergética | Pontos de Sobrecarga (PS) | ❌ |
| Ilusionista das Sombras | Pontos de Umbros (PU) | ❌ |
| Arconte | Pontos de Essência (PE) | ❌ |
| Tecno-Mago | Slots de Magia (tabela por nível) | ❌ |
| Hacker Corporativo | Pontos de Acesso (PA) | ❌ |
| Algoz Cibernético | Medidor de Calor (0-10, gauge de risco) | ❌ (comentário no código já reconhece isso) |
| Bastião Implacável | Cargas de Sacrifício (máx. 5) | ❌ (comentário no código já reconhece isso) |
| Herdeiro do Mar | Ciclo das Marés (troca de postura, não é pool) | ❌ |
| Herdeiro de Pedra | Pontos de Ressonância (PR) | ❌ |
| Desperto Vex | Fator Vex (FV) | ❌ |
| Predador Estelar | Contrato de Caça, dado escalado por nível (não é pool) | 🟡 só o dado fixo de nível 1 (`bonus_dano_dado: "1d6"`), sem escala e sem exigir marcação prévia |

## Mecânica de combate por classe (o que já reflete `Readme.txt` no nível 1)

| Classe | CA especial | Ataque de assinatura | Bônus fixo de dano |
|---|---|---|---|
| Herdeiro Tático | ❌ genérica | ❌ (usa arma) | ✅ 1d6 furtivo |
| Anomalia Bioenergética | ❌ genérica | ✅ Pulso de Quasiluz (Carisma, 1d10 energia) | — |
| Ilusionista das Sombras | ❌ genérica | ✅ Lâmina/Raio Sombrio (Inteligência, 1d8 necrótico) | — |
| Arconte | ❌ genérica | ✅ Sintonização Primordial (Sabedoria, 1d10 elemental) | — |
| Tecno-Mago | ❌ genérica | ✅ Compilador Sintético (Inteligência, 1d10 arcano-digital) | — |
| Hacker Corporativo | ✅ `10+INT+DES` | ❌ (usa arma/drone genérico) | — |
| Algoz Cibernético | ✅ `13+CON` | ❌ (usa arma) | — |
| Bastião Implacável | ❌ genérica | ❌ (usa arma) | — |
| Herdeiro do Mar | ❌ genérica | ❌ (usa arma) | — |
| Herdeiro de Pedra | ✅ `13+CON` | ❌ (usa arma) | — |
| Desperto Vex | ❌ genérica | ✅ Golpe Instintivo (Força, 1d8 natural) | — |
| Predador Estelar | ✅ `13+DES` | ❌ (usa arma) | ✅ 1d6 presa-marcada |

## Resumo

O que passou de ❌/🟡 para ✅ até agora: **Descanso** (curto/longo, com Dados de Vida reais em vez do heal fixo de 50%), **Teste contra a Morte** (loop completo de sucessos/falhas, incluindo o caso especial de dano a 0 HP e a ação de estabilizar um aliado), **Teste de perícia** (o intent `"teste"` e `handleTeste` eram código morto — ficaram alcançáveis via fallback `classificarComOllama` + `resolverManobra`, sem a IA nunca definir CD/atributo), e **Perícias oficiais + perícias iniciais por classe** (lista de 14 perícias corrigida para bater com o livro, bug de Medicina regida por Sabedoria em vez de Inteligência corrigido, e `pericias_iniciais` das 12 classes modelado e somado em `rollD20Test` como `bonus_classe`). Tudo o mais listado acima — condições, os 8 pontos de recurso de classe distintos, e as 12 árvores de subclasse — continua fora do escopo e seria, cada um, um projeto à parte (principalmente os pontos de recurso: são 8 sistemas de economia de ação diferentes, um por classe, mais o Medidor de Calor e o Ciclo das Marés que nem são pools simples). Um gap de integração menor ficou registrado na linha de "Teste de perícia": o caminho via `resolverManobra` ainda não repassa o nome da perícia para `rollD20Test`, então o `bonus_classe` só é aplicado quando alguém chama `rollD20Test` com o nome da perícia diretamente.
