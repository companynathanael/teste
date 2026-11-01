# asafe — agente de servidores

O **Asafe** é o centro da rede de IAs: conecta o agente principal (**Horácio**) às demais IAs (Miqueias, etc.) por **linhas de servidor** e armazena os dados de cada uma.

## Abas

| Aba | O que faz |
| --- | --- |
| **Dados de Servidores** | Cada IA tem um servidor dentro do Asafe, com pastas (Memória, Conversas, Logs, Configurações + pastas próprias). Envie arquivos, crie registros, busque, baixe e apague dados. |
| **Linhas de Conexão** | Fluxograma com o Asafe no centro. Adicione IAs e arraste do conector (●) de um nó até outro para criar uma linha. Nós sem caminho até o Asafe ficam *isolados*. |
| **Permissões** | O Asafe **decide sozinho** os pedidos entre agentes (ex.: Horácio → Miquéias): a **consciência** recusa automaticamente o que envolver dados pessoais de terceiros, senhas, apagar dados, dinheiro real ou atividades ilegais, e o resto é permitido. Também tem regras, permissões ativas (com Retirar), o modo "Perguntar" opcional e o histórico. |

### Atalhos do fluxograma
- Arrastar fundo: mover · roda do mouse: zoom
- Clique em nó/linha: selecionar · `Delete`: remover seleção · `Esc`: limpar
- Duplo clique em uma IA: abre os dados dela

## Linhas de servidor (conexão real entre os agentes)

O Asafe roteia mensagens entre as IAs seguindo as linhas desenhadas no fluxograma. Exemplo: com **Asafe ⇄ Miquéias ⇄ Horácio** ligados, o Horácio pode pedir algo ao Miquéias (`peça ao Miquéias que …`) e a resposta volta pelo Asafe. Cada pedido fica registrado em `Conversas/linha-AAAA-MM-DD.log` no servidor das duas IAs.

- Protocolo: [`protocol/PROTOCOLO.md`](protocol/PROTOCOLO.md)
- SDK para os agentes: [`sdk/asafe-link.js`](sdk/asafe-link.js)
- Controle de tela (`ui.*`): [`sdk/asafe-ui.js`](sdk/asafe-ui.js), para o Horácio operar a tela de outro agente com o aviso "Horácio está operando" e o botão Parar
- Integrações prontas: [`integrations/horacio.patch`](integrations/horacio.patch), [`integrations/miqueias.patch`](integrations/miqueias.patch)

Dois modos, escolhidos automaticamente:

- **Navegador**: deixe o Asafe aberto no mesmo navegador dos agentes. Ele mesmo faz o roteamento, sem instalar nada.
- **Servidor**: `node server/asafe-server.js` (porta 7300). Grava os logs em `server/data/logs/`.

## Rodar

Sem build. Abra `index.html` no navegador ou sirva a pasta:

```bash
python3 -m http.server 8080
```

Os dados ficam no navegador (`localStorage`, ~5 MB). Use os botões de **exportar/importar backup** no topo. A camada de dados está isolada em `js/store.js` para ser trocada por um backend real depois.

## Estrutura

```
index.html
css/style.css     tema preto/vermelho, vidro fosco, animações
js/store.js       dados: IAs, linhas, pastas, arquivos, rotas
js/ui.js          toasts, modais, formatação
js/data.js        aba Dados de Servidores
js/flow.js        aba Linhas de Conexão (fluxograma)
js/app.js         boot, abas, backup
js/bus.js         roteador das linhas (navegador) / ponte com o servidor
js/perms.js       permissões de execução: pedidos, regras e histórico
sdk/              asafe-router.js (regras), asafe-link.js (SDK dos agentes) e asafe-ui.js (controle de tela)
server/           servidor Node opcional
integrations/     patches do Horácio e do Miquéias
tools/            build-single.py gera dist/asafe.html
assets/           logos (marca e marca + nome)
```
