# Protocolo Asafe · v1

O **Asafe** é o centro das IAs da Nathanael Industries. Um agente nunca fala direto com outro: ele manda um **envelope** ao Asafe, o Asafe confere as **linhas de servidor** (o fluxograma da aba *Linhas de Conexão*) e entrega ao destino.

```
Horácio ──► Asafe ──► Miquéias
        ◄──       ◄──  (resposta pelo mesmo caminho)
```

## 1. Identificação

Cada agente tem um `id` fixo: o nome cadastrado no Asafe em minúsculas, sem acento e sem espaços.

| Agente | id |
| --- | --- |
| Asafe (núcleo) | `asafe` |
| Horácio | `horacio` |
| Miquéias | `miqueias` |

Uma IA nova, por exemplo "Ezequiel", vira `ezequiel` assim que é adicionada no Asafe.

## 2. Envelope

Todo tráfego é um objeto JSON:

```json
{
  "asafe": 1,
  "id": "msg_k3j2h1g0abcde",
  "type": "request",
  "from": "horacio",
  "to": "miqueias",
  "action": "chat.ask",
  "payload": { "prompt": "Explique o que é uma API" },
  "ts": 1793549000000
}
```

| Campo | Obrigatório | Descrição |
| --- | --- | --- |
| `asafe` | sim | versão do protocolo, sempre `1` |
| `id` | sim | identificador único da mensagem |
| `type` | sim | `hello`, `bye`, `request`, `response`, `progress` ou `event` |
| `from` | sim | id de quem envia |
| `to` | sim, exceto em `hello`/`bye` | id do destino (`asafe` para falar com o núcleo) |
| `action` | em `request` | nome da ação, por exemplo `chat.ask` |
| `payload` | não | dados da ação |
| `replyTo` | em `response`/`progress` | `id` do pedido respondido |
| `ok` / `error` | em `response` | `ok: true` e `payload`, ou `ok: false` e `error: { code, message }` |
| `via` / `route` | colocados pelo Asafe | `via: "asafe"` e o caminho usado, ex.: `["horacio","miqueias"]` |

### Tipos

- **hello**: o agente se apresenta e repete a cada 5 s (heartbeat). `payload: { name, role, kind, actions: [{ name, desc }] }`
- **bye**: o agente está saindo.
- **request**: pede para outro agente executar uma `action`.
- **progress**: resposta parcial (streaming), ex.: `{ "delta": "texto" }`.
- **response**: resultado final do pedido.
- **event**: aviso sem resposta.

## 3. Regras de roteamento

O Asafe só entrega um pedido quando:

1. as duas pontas estão cadastradas no Asafe (`unknown_agent`);
2. as duas pontas têm linha de servidor até o Asafe (`no_route`);
3. existe caminho de linhas entre elas (`no_route`);
4. o destino está com a interface aberta e conectada (`offline`).

Caso contrário, o próprio Asafe responde ao remetente com `ok: false` e o código entre parênteses. Outros códigos: `timeout`, `unknown_action`, `busy`, `not_ready`, `bad_request`, `model_error`.

Ações do próprio núcleo (`to: "asafe"`):

| Ação | Resposta |
| --- | --- |
| `ping` | `{ pong: true, ts }` |
| `roster` | `{ agents: [{ id, name, kind, online, actions, route }] }` |

## 4. Ações publicadas

### Miquéias (`miqueias`)

| Ação | payload | resposta |
| --- | --- | --- |
| `chat.ask` | `{ prompt, newChat = true }` | `{ reply, model, chatId }`, com `progress { delta }` enquanto escreve |
| `chat.new` | `{}` | `{ ok: true }` |
| `settings.model` | `{ model: "demo" \| "claude-opus-5-5" \| "claude-sonnet-5-5" \| "claude-haiku-5-5" }` | `{ model, label }` |
| `ping` | `{}` | `{ ready, busy, model }` |

| `research.run` | `{ query }` | `{ reply, sources: [{ title, url }], searches, model }`, com `progress { delta }` enquanto escreve. Pesquisa na web com a busca do Claude (precisa da chave da API; no modo demo responde com a base local e avisa) |
| `trade.status` | `{}` | `{ equity, cash, start, returnPct, position, trades, autopilot: { on, mode, strategy, symbol }, lessonsStudied, lastStudy, journal }` (journal = 10 últimas entradas) |
| `trade.study` | `{}` | `{ ranking: [{ strategy, avgReturnPct }], insights, source }`. Testa 3 estratégias em BTC/ETH/SOL (1h e 4h); leva de 10 a 60 s |
| `trade.autopilot` | `{ on = true, strategy?: "cruzamento" \| "rsi" \| "rompimento", symbol?: "BTCUSDT" \| "ETHUSDT" \| "SOLUSDT", mode?: "replay" \| "live" }` | `{ on, strategy, mode, symbol, source }` ou `{ on: false }` |

O pedido de `chat.ask` e `research.run` aparece na interface do Miquéias como uma conversa nova chamada `⇄ Horácio: …`. As ações `trade.*` operam o **Laboratório de Trade** do Miquéias, sempre com **dinheiro fictício**.

Todas as ações, exceto `ping`, `trade.status` e `settings.model`, recusam com `not_ready` se o Miquéias estiver na tela de entrada. Estratégia ou ativo inválidos voltam como `bad_request`.

### Horácio (`horacio`)

| Ação | payload | resposta |
| --- | --- | --- |
| `notify` | `{ text }` | `{ shown: true }`: mostra a mensagem na conversa do Horácio |
| `ping` | `{}` | `{ ready: true }` |

No Horácio, o Sr. Nathanael escreve, por exemplo:

- `peça ao Miquéias que explique o que é uma API`
- `@miqueias escreva um plano para o lançamento`
- `Miquéias, resuma este texto: …`
- `/agentes` para ver quem está conectado

Habilidades do Miquéias pelo Horácio (detalhes em `docs/CONTROLE.md` do repositório do Horácio):

| Comando no Horácio | Ação enviada |
| --- | --- |
| `Miquéias, pesquise sobre …`, `@miqueias busque …`, `peça ao Miquéias que pesquise …`, `/pesquisa …` | `research.run { query }` (espera até 180 s; mostra as fontes como links) |
| `Miquéias, como está o trade?`, `/trade` | `trade.status` |
| `Miquéias, faça um estudo de trade`, `Miquéias, teste as estratégias`, `/estudo` | `trade.study` (espera até 120 s) |
| `Miquéias, ligue o piloto automático em ETH com RSI ao vivo`, `/piloto on …` | `trade.autopilot { on: true, … }`, só depois de **Confirmar** no Horácio |
| `Miquéias, desligue o piloto`, `/piloto off` | `trade.autopilot { on: false }` |

## 5. Controle de tela (`ui.*`)

Com a permissão do Sr. Nathanael, o Horácio pode **operar a tela** de outro agente como uma pessoa: ler, clicar, digitar, rolar e esperar. São `request`/`response` normais do protocolo v1, e o roteador não muda.

Especificação completa: `docs/CONTROLE.md` no repositório companynathanael/Hor-cio-Jarvis. Implementação pronta para qualquer agente: [`sdk/asafe-ui.js`](../sdk/asafe-ui.js).

| Ação | payload | resposta |
| --- | --- | --- |
| `ui.snapshot` | `{}` | `{ app, screen, elements: [{ ref, role, name, value?, state?, protected? }], text? }` |
| `ui.click` | `{ ref? \| name?, confirm? }` | `{ done: true, target }` |
| `ui.type` | `{ text, ref? \| name?, clear = true, submit = false, confirm? }` | `{ done: true, target }` |
| `ui.key` | `{ key, ref? }` | `{ done: true }` |
| `ui.scroll` | `{ direction: "up" \| "down" \| "top" \| "bottom", ref? }` | `{ done: true }` |
| `ui.wait` | `{ text?, idle?, timeout = 15000 }` | `{ found: true }` ou erro `timeout` |
| `ui.control` | `{ on, by }` | `{ on }` |

Evento do agente controlado para quem opera: `ui.stopped { reason: "user" }`.

Regras de segurança:

- Qualquer ação `ui.*` mostra no agente o aviso **"Horácio está operando"** com o botão **Parar**. O controle nunca fica invisível.
- Depois de **Parar**, o agente recusa os próximos `ui.*` com `stopped` até receber um novo `ui.control { on: true }`.
- Elementos protegidos (sair da conta, apagar conversas, senha, chave da API, salvar configurações) recusam sem `confirm: true` (`needs_confirmation`). O Horácio só manda `confirm` depois que o Sr. Nathanael aperta **Confirmar**.
- O `ui.snapshot` nunca devolve o valor de senhas nem da chave da API.
- Outros erros: `not_found`, `ambiguous` (com `candidates`), `disabled`, `bad_request`.

Uso num agente, depois do `asafe-link.js`:

```html
<script src="asafe-ui.js"></script>
<script>
  AsafeUI.attach(link, {
    app: "Miquéias", mainInput: "#input",
    isBusy: () => !!state.busy,
    protected: [{ selector: '[data-action="logout"]', reason: "Sair da conta" }]
  });
</script>
```

No Horácio: `Miquéias, leia a tela`, `Miquéias, clique em Nova conversa`, `Miquéias, digite "Olá" e depois envie`, `@miqueias role para baixo`, `Miquéias, espere a resposta`.

Cada passo passa pelo Asafe e fica no log `Conversas` das duas IAs, com o conteúdo cortado em 600 caracteres.

## 6. Transportes

O SDK [`sdk/asafe-link.js`](../sdk/asafe-link.js) escolhe sozinho:

| Modo | Quando | Como |
| --- | --- | --- |
| **servidor** | `node server/asafe-server.js` rodando (porta 7300) | `GET /stream?agent=id` (SSE) para receber, `POST /send` para enviar. Logs em `server/data/logs/<id>.jsonl` |
| **navegador** | sem servidor | `BroadcastChannel("asafe-bus")`. A página do Asafe precisa estar aberta no mesmo navegador: ela é o roteador. No Chrome funciona inclusive com os arquivos `.html` abertos com dois cliques |

No modo navegador, os agentes enviam `{ dir: "up", env }` no canal; o Asafe entrega `{ dir: "down", env }` e manda `core.heartbeat` a cada 4 s.

## 7. Usando o SDK

```html
<script src="asafe-link.js"></script>
<script>
  const link = AsafeLink.connect({
    id: "miqueias", name: "Miquéias", role: "IA auxiliar", kind: "ia",
    actions: {
      "chat.ask": {
        desc: "Responde a um pedido",
        handler: async ({ prompt }, ctx) => {
          ctx.progress({ delta: "..." });  // opcional: streaming
          return { reply: "texto final" };
        }
      }
    }
  });

  link.on("status", ({ status, mode }) => console.log(status, mode)); // connecting | waiting | online | offline
  const r = await link.request("miqueias", "chat.ask", { prompt: "Oi" }, { onProgress: p => console.log(p.delta) });
  const agentes = await link.roster();
</script>
```

Para os HTML de arquivo único, cole o conteúdo de `asafe-link.js` num `<script>` antes do código do agente.
