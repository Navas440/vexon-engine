# Contrato Oficial - Sistema de Criação de Entidades (Vexon)

Este documento define o padrão obrigatório de comunicação entre a IA (Mestre Supremo de Vexon) e o backend.

O backend é a única autoridade matemática do sistema.

---

# Regras Gerais

1. A resposta deve conter APENAS JSON válido.
2. Não pode existir texto antes ou depois do JSON.
3. A IA nunca define:
   - HP
   - Ataque
   - Defesa
   - Valores numéricos finais
4. A IA nunca faz balanceamento.
5. A IA define apenas intenção narrativa.
6. O backend é o único responsável por cálculos e escalonamento.

---

# Contrato - Criação de NPC

Formato obrigatório:

```json
{
  "action": "create_npc",
  "data": {
    "nome": "string",
    "alinhamento": "bom | neutro | caotico | maligno",
    "nivel_social": "comum | influente | lider",
    "arquetipo": "mercador | plebeu | guarda | aventureiro | clerigo | mercenario | guerreiro | mago | nobre | criminoso",
    "personalidade": "string",
    "descricao": "string",
    "habilidade_tematica": "string",
    "classe": "string (opcional, uma das 12 classes de combate)"
  }
}
```

Observações:
- Nenhum atributo numérico é permitido.
- O backend traduz nivel_social e alinhamento em influência e comportamento interno.
- "classe" é opcional — só incluir quando o NPC for narrativamente relevante em combate (não para
  todo comerciante/civil). Valores fora das 12 classes válidas são ignorados (viram null) pelo
  backend, sem gerar erro.

---

# Contrato - Criação de Item

Formato obrigatório:

```json
{
  "action": "create_item",
  "data": {
    "nome": "string",
    "raridade": "comum | raro | epico | lendario",
    "tipo": "arma | armadura | consumivel | artefato",
    "descricao": "string",
    "habilidade_tematica": "string",
    "efeito": {
      "tipo": "dano | defesa | buff",
      "intensidade": "baixa | media | alta",
      "alvo": "forca | defesa | velocidade | nenhum"
    }
  }
}
```

Observações:
- A IA define apenas o tipo e intensidade narrativa.
- O backend converte intensidade em valores reais.
- Nenhum número pode ser definido pela IA.

---

# Contrato - Criação de Monstro

Formato obrigatório:

```json
{
  "action": "create_monster",
  "data": {
    "nome": "string",
    "ameaca": "baixa | media | alta | elite | chefe",
    "tipo": "string",
    "descricao": "string",
    "habilidade_tematica": "string",
    "classe": "string (opcional, uma das 12 classes de combate)"
  }
}
```

Observações:
- A IA define apenas a ameaça narrativa.
- O backend traduz "ameaca" em nível numérico.
- HP, ataque e defesa são calculados exclusivamente pelo backend.
- "classe" é opcional — só incluir quando o monstro for narrativamente relevante em combate (ex:
  um chefe). Valores fora das 12 classes válidas são ignorados (viram null) pelo backend, sem gerar
  erro.

---

# Fluxo Oficial

1. IA responde com JSON válido.
2. Backend faz parse.
3. Backend valida o formato.
4. Backend traduz intenção narrativa em valores matemáticos.
5. Entidade final é criada pelo sistema.

---

Este documento é a fonte oficial de verdade para integração IA ↔ Backend.
Qualquer alteração deve ser refletida aqui antes de ser implementada no código.