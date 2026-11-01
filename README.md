# asafe — agente de servidores

O **Asafe** é o centro da rede de IAs: conecta o agente principal (**Horácio**) às demais IAs (Miqueias, etc.) por **linhas de servidor** e armazena os dados de cada uma.

## Abas

| Aba | O que faz |
| --- | --- |
| **Dados de Servidores** | Cada IA tem um servidor dentro do Asafe, com pastas (Memória, Conversas, Logs, Configurações + pastas próprias). Envie arquivos, crie registros, busque, baixe e apague dados. |
| **Linhas de Conexão** | Fluxograma com o Asafe no centro. Adicione IAs e arraste do conector (●) de um nó até outro para criar uma linha. Nós sem caminho até o Asafe ficam *isolados*. |

### Atalhos do fluxograma
- Arrastar fundo: mover · roda do mouse: zoom
- Clique em nó/linha: selecionar · `Delete`: remover seleção · `Esc`: limpar
- Duplo clique em uma IA: abre os dados dela

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
assets/           logos (marca e marca + nome)
```
