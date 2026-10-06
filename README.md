# WA Exporter

Extensão para exportar contatos e dados do WhatsApp Web diretamente do navegador.

## O que essa extensão faz

A extensão lê os dados que o WhatsApp Web já guarda localmente no IndexedDB do navegador (`model-storage`).

Ela não envia dados para servidores externos e não envia informações para fora do seu computador. Tudo acontece localmente no navegador.

### Funcionalidades

- lê contatos armazenados no WhatsApp Web
- tenta extrair nomes e números
- identifica e mostra etiquetas quando disponíveis
- exporta os dados em CSV
- permite escolher o separador do arquivo CSV (`;` ou `,`)
- mostra um diagnóstico dos stores do IndexedDB para ajudar a entender a estrutura real do WhatsApp

## Como funciona

A extensão possui:

- `content.js`: roda dentro da página do WhatsApp Web e acessa o IndexedDB local
- `popup.html` e `popup.js`: interface da extensão, com botão de exportação e diagnóstico
- `manifest.json`: configura a extensão no Chrome/Chromium

## Importante

Essa extensão depende da estrutura interna do WhatsApp Web e do IndexedDB do navegador. Como o WhatsApp pode mudar a estrutura dos dados em versões diferentes, alguns campos podem variar entre contas e versões.

A extensão foi criada para leitura local e exportação de dados do próprio WhatsApp Web do usuário, sem persistir ou enviar essas informações para fora do ambiente local.

## Como usar

1. Abra o WhatsApp Web no navegador.
2. Carregue a extensão no Chrome/Edge habilitando extensões em modo desenvolvedor.
3. Clique na extensão.
4. Escolha o separador do CSV.
5. Clique em "Exportar CSV".
6. O arquivo será baixado em CSV para uso em Excel ou outros programas.

## Observações

- A extensão acessa somente os dados locais do WhatsApp Web já presentes no navegador.
- Não é um scraper de celular ou de rede social remota.
- Ela não realiza login em nenhum site externo.
- O uso depende das permissões do navegador e da estrutura interna do WhatsApp Web no momento da execução.
