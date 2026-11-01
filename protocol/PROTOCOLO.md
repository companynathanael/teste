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

O pedido aparece na interface do Miquéias como uma conversa nova chamada `⇄ Horácio: …`.

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

## 5. Transportes

O SDK [`sdk/asafe-link.js`](../sdk/asafe-link.js) escolhe sozinho:

| Modo | Quando | Como |
| --- | --- | --- |
| **servidor** | `node server/asafe-server.js` rodando (porta 7300) | `GET /stream?agent=id` (SSE) para receber, `POST /send` para enviar. Logs em `server/data/logs/<id>.jsonl` |
| **navegador** | sem servidor | `BroadcastChannel("asafe-bus")`. A página do Asafe precisa estar aberta no mesmo navegador: ela é o roteador. No Chrome funciona inclusive com os arquivos `.html` abertos com dois cliques |

No modo navegador, os agentes enviam `{ dir: "up", env }` no canal; o Asafe entrega `{ dir: "down", env }` e manda `core.heartbeat` a cada 4 s.

## 6. Usando o SDK

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
