/**
 * Portal do Franqueado — Programa A & Programa B
 * ===============================================
 * Arquivo principal do Apps Script (server-side).
 *
 * ARQUITETURA (v4 — SPA no navegador + UMA ÚNICA planilha de dados):
 * doGet() faz UMA única leitura de todas as fontes de dados (inscritos dos
 * dois programas, calendário anual e calendário semanal de cada programa),
 * serializa tudo em um único JSON (`dadosJson`) e serve o Index.html — que
 * é o front-end inteiro (CSS, HTML e JS de todas as "telas"). A troca de
 * tela (Início / Programa A / Programa B / Calendário Anual / Inscritos)
 * acontece 100% no navegador, sem recarregar a página.
 *
 * TODOS OS DADOS VIVEM NA PLANILHA "PORTAL" (ver SHEET_ID), com 4 abas:
 *
 *   Calendario_Anual          -> Calendário Anual (uma linha por mês/turma)
 *   Programa A               -> Cronograma semanal do Programa A (grade)
 *   Programa B                 -> Cronograma semanal do Programa B (grade)
 *   Inscritos   -> Lista de inscritos dos dois programas, em
 *                                dois blocos na mesma aba (cada bloco tem
 *                                uma linha de título "INSCRITOS PROGRAMA A"
 *                                / "INSCRITOS PROGRAMA B" seguida do
 *                                cabeçalho de colunas).
 *
 * TRATAMENTO DE ERRO: cada fonte é lida dentro de tryGet_(), que captura
 * qualquer exceção (ex.: planilha não compartilhada com quem está acessando)
 * e devolve um valor vazio em vez de quebrar a página inteira. Os erros vão
 * para `dados.erros` — abra o Console do navegador (F12) e digite
 * `DADOS.erros` para ver o motivo exato se algum bloco aparecer vazio.
 *
 * IMPORTANTE — implantação:
 *  Este Web App é publicado com:
 *    Executar como: Usuário que acessa o app
 *    Quem pode acessar: "Qualquer pessoa em [Organização]" (ver
 *    GUIA_DE_IMPLANTACAO.md)
 *  Como cada visitante lê a planilha com a PRÓPRIA conta, a planilha PORTAL
 *  precisa estar compartilhada (leitor) com todos que vão acessar o portal.
 */

// ---------------------------------------------------------------------------
// CONFIGURAÇÃO GERAL
// ---------------------------------------------------------------------------

/** ID da planilha única "PORTAL" — fonte de TODOS os dados do portal. */
var SHEET_ID = 'SEU_ID_DA_PLANILHA';

/** Nomes das abas dentro da planilha PORTAL. */
var ABA_CALENDARIO_ANUAL = 'Calendario_Anual';
var ABA_INSCRITOS = 'Inscritos';

/**
 * Domínios de e-mail liberados para acessar o portal.
 * suaempresa.com.br      -> funcionários da empresa
 * parceiros.com.br -> franqueados e contratados (equipes)
 * Ajuste esta lista caso novos domínios precisem ser liberados.
 */
var ALLOWED_DOMAINS = ['suaempresa.com.br', 'parceiros.com.br'];

/**
 * Os dois programas. `cronogramaAba` é o nome da aba com a grade do
 * cronograma semanal; `tituloInscritos` é o trecho que identifica o bloco
 * do programa na aba de inscritos.
 */
var PROGRAMAS = {
  'programa-a': {
    key: 'programa-a',
    label: 'Programa A',
    cronogramaAba: 'Programa A'
  },
  'programa-b': {
    key: 'programa-b',
    label: 'Programa B',
    cronogramaAba: 'Programa B'
  }
};
var PROGRAMA_PADRAO = 'programa-a';

// ---------------------------------------------------------------------------
// ROTEAMENTO / CONTROLE DE ACESSO
// ---------------------------------------------------------------------------

/**
 * Ponto de entrada do Web App. Serve sempre o Index.html (SPA) com todos os
 * dados já embutidos como JSON — a navegação entre telas é feita no
 * navegador, sem nova requisição ao servidor.
 * @param {Object} e Evento doGet do Apps Script (não usado para roteamento
 *   nesta versão, mantido apenas pela assinatura padrão do Apps Script).
 */
function doGet(e) {
  var email = getRequesterEmail_();
  var domain = getEmailDomain_(email);
  var accessGranted = !!email && ALLOWED_DOMAINS.indexOf(domain) !== -1;

  var tpl = HtmlService.createTemplateFromFile('Index');
  tpl.accessGranted = accessGranted;
  tpl.userEmail = email;
  tpl.dadosJson = accessGranted ? JSON.stringify(montarDados_()) : '{}';

  return tpl.evaluate()
    .setTitle('Portal do Franqueado')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setFaviconUrl('https://www.gstatic.com/images/branding/product/1x/apps_script_48dp.png')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Monta o pacote único de dados que o front-end (Index.html) consome.
 * Cada fonte é lida isoladamente via tryGet_() — se uma planilha falhar
 * (ex.: sem compartilhamento com quem acessa), as outras continuam
 * funcionando normalmente e o erro fica registrado em `erros`.
 */
function montarDados_() {
  var erros = [];
  // A aba de inscritos traz os dois programas juntos: lê uma vez só.
  var inscritos = tryGet_(function () { return getInscritosPorPrograma_(); },
    { 'programa-a': [], 'programa-b': [] }, erros, 'Inscritos');
  var vazioSemanal = { eventos: [], turmaInicio: '', turmaFim: '' };
  return {
    inscritos: inscritos,
    calendarioAnual: tryGet_(function () { return getCalendarioAnual(); }, [], erros, 'Calendário Anual'),
    calendarioSemanal: {
      'programa-a': tryGet_(function () { return getCalendarioSemanalTurmaAtual_('programa-a'); }, vazioSemanal, erros, 'Calendário Semanal Programa A'),
      'programa-b': tryGet_(function () { return getCalendarioSemanalTurmaAtual_('programa-b'); }, vazioSemanal, erros, 'Calendário Semanal Programa B')
    },
    erros: erros
  };
}

/** Executa fn(); se lançar exceção, registra em `erros` e devolve `fallback`. */
function tryGet_(fn, fallback, erros, label) {
  try {
    return fn();
  } catch (err) {
    erros.push(label + ': ' + err.message);
    return fallback;
  }
}

/** Retorna o e-mail de quem está acessando o Web App (ou '' se indisponível). */
function getRequesterEmail_() {
  try {
    var email = Session.getActiveUser().getEmail();
    return email || '';
  } catch (err) {
    return '';
  }
}

/** Extrai o domínio (parte após o @) de um e-mail, em minúsculas. */
function getEmailDomain_(email) {
  if (!email || email.indexOf('@') === -1) return '';
  return email.split('@')[1].toLowerCase();
}

/** Resolve a chave de programa para o objeto de configuração completo. */
function resolvePrograma_(programaKey) {
  return PROGRAMAS[programaKey] || PROGRAMAS[PROGRAMA_PADRAO];
}

// ---------------------------------------------------------------------------
// LEITURA GENÉRICA DE PLANILHA
// ---------------------------------------------------------------------------

/**
 * Lê uma aba inteira de QUALQUER planilha (por ID) e devolve
 * { headers: [...], rows: [{header: valor}] }. Ignora linhas totalmente
 * vazias. Os cabeçalhos são usados como chaves exatas (com trim), então esta
 * função é resiliente a mudanças de ordem de colunas — desde que os nomes de
 * cabeçalho não mudem.
 */
function sheetToObjects_(sheetId, sheetName) {
  var ss = SpreadsheetApp.openById(sheetId);
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { headers: [], rows: [] };

  var values = sheet.getDataRange().getValues();
  if (values.length < 1) return { headers: [], rows: [] };

  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var isEmpty = row.every(function (c) { return c === '' || c === null || c === undefined; });
    if (isEmpty) continue;

    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j];
    }
    rows.push(obj);
  }
  return { headers: headers, rows: rows };
}

/** Normaliza texto (trim + lowercase) para comparações de status. */
function norm_(v) {
  return String(v === null || v === undefined ? '' : v).trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// LISTA DE INSCRITOS (aba "Inscritos" da planilha PORTAL)
// ---------------------------------------------------------------------------

/**
 * Lê a aba de inscritos, que traz os DOIS programas em blocos sequenciais:
 *
 *   INSCRITOS PROGRAMA A - Equipe Comercial   <- título
 *   FRANQUIA | ETIQUETA | Função | Nome completo... | E-mail... | E-mail do Franqueado
 *   ...linhas de pessoas...
 *   INSCRITOS PROGRAMA B - Equipe Logística ...            <- título
 *   FRANQUIA | ETIQUETA | ...                                <- cabeçalho
 *   ...linhas de pessoas...
 *
 * O bloco é identificado pela linha de título (começa com "INSCRITOS"; se
 * contiver "PROGRAMA B" é o Programa B, senão é o Programa A) e as colunas
 * são localizadas pelo NOME no cabeçalho — então a ordem das colunas pode
 * mudar sem quebrar o portal. Devolve { 'programa-a': [...], 'programa-b': [...] }.
 * A aba é substituída manualmente a cada novo ciclo, então não há filtro de
 * data aqui: exibimos exatamente o que está nela.
 */
function getInscritosPorPrograma_() {
  var resultado = { 'programa-a': [], 'programa-b': [] };
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(ABA_INSCRITOS);
  if (!sheet) throw new Error('Aba "' + ABA_INSCRITOS + '" não encontrada na planilha PORTAL.');

  var values = sheet.getDataRange().getValues();
  var programaAtual = null;
  var cols = null;

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var vazia = row.every(function (c) { return c === '' || c === null || c === undefined; });
    if (vazia) continue;

    var primeira = norm_(row[0]);
    var restoVazio = row.slice(1).every(function (c) { return String(c).trim() === ''; });

    // Linha de título de bloco ("INSCRITOS ...")
    if (primeira.indexOf('inscritos') === 0 && restoVazio) {
      programaAtual = primeira.indexOf('programa b') !== -1 ? 'programa-b' : 'programa-a';
      cols = null;
      continue;
    }

    // Linha de cabeçalho do bloco
    if (primeira === 'franquia') {
      cols = mapearColunasInscritos_(row);
      continue;
    }

    if (!programaAtual || !cols) continue;

    var nome = String(row[cols.nome] || '').trim();
    if (!nome) continue;
    resultado[programaAtual].push({
      nome: nome,
      franquia: String(row[cols.franquia] || '').trim(),
      email: String(row[cols.email] || '').trim().toLowerCase(),
      etiqueta: String(row[cols.etiqueta] || '').trim(),
      funcao: String(row[cols.funcao] || '').trim(),
      emailFranqueado: String(row[cols.emailFranqueado] || '').trim().toLowerCase()
    });
  }
  return resultado;
}

/** Descobre o índice de cada coluna pelo texto do cabeçalho (sem depender da ordem). */
function mapearColunasInscritos_(headerRow) {
  var h = headerRow.map(function (c) { return norm_(c); });
  function achar(pred, padrao) {
    for (var k = 0; k < h.length; k++) if (h[k] && pred(h[k])) return k;
    return padrao;
  }
  return {
    franquia: achar(function (t) { return t === 'franquia'; }, 0),
    etiqueta: achar(function (t) { return t === 'etiqueta'; }, 1),
    funcao: achar(function (t) { return t.indexOf('fun') === 0; }, 2),
    nome: achar(function (t) { return t.indexOf('nome') === 0; }, 3),
    emailFranqueado: achar(function (t) { return t.indexOf('franqueado') !== -1 && t.indexOf('mail') !== -1; }, 5),
    email: achar(function (t) { return t.indexOf('mail') !== -1 && t.indexOf('franqueado') === -1; }, 4)
  };
}

/** Inscritos de um único programa ('programa-a' ou 'programa-b'). */
function getInscritos(programaKey) {
  return getInscritosPorPrograma_()[resolvePrograma_(programaKey).key] || [];
}

// ---------------------------------------------------------------------------
// CALENDÁRIOS
// ---------------------------------------------------------------------------

function getCalendarioAnual() {
  var data = sheetToObjects_(SHEET_ID, ABA_CALENDARIO_ANUAL);
  return data.rows.map(function (r) {
    return {
      mes: String(r['Mês'] || '').trim(),
      turma: String(r['Turma/Programa'] || '').trim(),
      dataInicio: formatDateCell_(r['Data Início']),
      dataFim: formatDateCell_(r['Data Fim']),
      dataInicioRaw: toDateValue_(r['Data Início']),
      dataFimRaw: toDateValue_(r['Data Fim']),
      modalidade: String(r['Modalidade'] || '').trim(),
      status: String(r['Status'] || '').trim(),
      observacoes: String(r['Observações'] || '').trim()
    };
  });
}

// Reconhece cabeçalhos de coluna no formato "Segunda (05/10)", "Terça(06/10)" etc.
var DIA_SEMANA_REGEX = /^(domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado)[^\d]*(\d{1,2})\/(\d{1,2})/i;

/**
 * Lê a grade de horários de um programa a partir da planilha PORTAL (abas
 * "Programa A" e "Programa B", mantidas pela equipe e atualizadas mês a mês
 * — a aba é substituída todo mês pela turma vigente, então não há "escolha
 * de turma" a fazer aqui: é sempre o que estiver na aba). Formato da grade: uma linha
 * de cabeçalho com "NomeDoDia (dd/mm)" por coluna, e as linhas seguintes são
 * blocos de horário (manhã Estudo Individual, manhã Live, tarde Estudo
 * Individual, tarde Live, extras) — cada célula não vazia é um evento
 * daquele dia/coluna. Linhas puramente decorativas ("Matinal", "ALMOÇO",
 * "PRIMEIRA SEMANA"/"SEGUNDA SEMANA") são ignoradas.
 */
function getCalendarioSemanalTurmaAtual_(programaKey) {
  var prog = resolvePrograma_(programaKey);
  var ss = SpreadsheetApp.openById(SHEET_ID);
  var sheet = ss.getSheetByName(prog.cronogramaAba);
  if (!sheet) return { eventos: [], turmaInicio: '', turmaFim: '' };

  var values = sheet.getDataRange().getValues();

  // 1) Acha a linha de cabeçalho de dias (a que tiver mais colunas batendo
  //    com o padrão "NomeDoDia (dd/mm)") e mapeia cada coluna reconhecida.
  var headerRowIdx = -1;
  var colInfo = [];
  for (var r = 0; r < values.length; r++) {
    var candidatos = [];
    for (var c = 0; c < values[r].length; c++) {
      var m = DIA_SEMANA_REGEX.exec(String(values[r][c] || '').trim());
      if (m) candidatos.push({ col: c, diaSemana: capitalize_(m[1]), dia: Number(m[2]), mes: Number(m[3]) });
    }
    if (candidatos.length >= 3) { headerRowIdx = r; colInfo = candidatos; break; }
  }
  if (headerRowIdx === -1) return { eventos: [], turmaInicio: '', turmaFim: '' };

  var ano = inferirAnoCronograma_(colInfo[0].mes);
  var hojeMs = new Date().setHours(0, 0, 0, 0);

  // 2) Para cada linha de conteúdo (depois do cabeçalho), extrai o(s)
  //    evento(s) de cada coluna mapeada.
  var eventos = [];
  for (var r2 = headerRowIdx + 1; r2 < values.length; r2++) {
    var row = values[r2];
    var primeiraCelula = norm_(row[0]);
    if (primeiraCelula === 'almoço' || primeiraCelula === 'almoco') continue; // linha decorativa

    colInfo.forEach(function (info) {
      var texto = String(row[info.col] || '').trim();
      if (!texto) return;
      var textoNorm = norm_(texto);
      if (textoNorm === 'matinal' || textoNorm === 'primeira semana' || textoNorm === 'segunda semana') return;

      var parsed = parseCelulaCronograma_(texto);
      if (!parsed) return;

      var dataObj = new Date(ano, info.mes - 1, info.dia);
      var dataMs = dataObj.getTime();
      var status = (parsed.tipo === 'Feriado') ? 'Feriado'
        : (dataMs < hojeMs ? 'Realizado' : (dataMs === hojeMs ? 'Em andamento' : 'Agendado'));

      eventos.push({
        data: Utilities.formatDate(dataObj, 'America/Sao_Paulo', 'dd/MM/yyyy'),
        dataValue: dataMs,
        diaSemana: info.diaSemana + '-feira',
        horaInicio: parsed.horaInicio,
        horaFim: parsed.horaFim,
        aula: parsed.titulo,
        tipo: parsed.tipo,
        link: '',
        status: status
      });
    });
  }

  eventos.sort(function (a, b) { return a.dataValue - b.dataValue; });

  // Remove duplicatas exatas (comuns quando a mesma célula de feriado
  // aparece repetida em mais de um bloco de horário da grade original).
  var vistos = {};
  eventos = eventos.filter(function (e) {
    var chave = e.data + '|' + e.aula + '|' + e.tipo + '|' + e.horaInicio;
    if (vistos[chave]) return false;
    vistos[chave] = true;
    return true;
  });

  eventos.forEach(function (e) { delete e.dataValue; });

  return {
    eventos: eventos,
    turmaInicio: eventos.length ? eventos[0].data : '',
    turmaFim: eventos.length ? eventos[eventos.length - 1].data : ''
  };
}

/** Deduz o ano do cronograma comparando o mês da planilha com o mês atual (a planilha não tem ano explícito). */
function inferirAnoCronograma_(mesPlanilha) {
  var hoje = new Date();
  var anoAtual = hoje.getFullYear();
  var mesAtual = hoje.getMonth() + 1;
  if (mesPlanilha < mesAtual - 6) return anoAtual + 1; // ex.: planilha de Janeiro vista em Novembro/Dezembro
  if (mesPlanilha > mesAtual + 6) return anoAtual - 1; // ex.: planilha de Dezembro vista em Janeiro/Fevereiro
  return anoAtual;
}

/**
 * Faz o parsing de uma célula da grade de cronograma, que pode vir em
 * formatos como:
 *   "Boas vindas\n(Live)\n09h00 às 10h30"
 *   "Negociação e Contorno de objeções (Estudo Individual)\n09h00 às 10h30"
 *   "ROTA + MISSÃO 1"                                 (sem tipo/horário)
 *   "ROTINAS DA FRANQUIA"                              (sem tipo/horário)
 *   "\nNossa Senhora de Aparecida (Feriado)\n"         (feriado, sem horário)
 *   "Teste de conhecimento final e finalização\n\n13h00 às 23h00"
 */
function parseCelulaCronograma_(texto) {
  var raw = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;

  var horaInicio = '', horaFim = '';
  var horaMatch = raw.match(/(\d{1,2})[h:](\d{2})h?\s*(?:às|as|-|–)\s*(\d{1,2})[h:]?(\d{2})?h?/i);
  if (horaMatch) {
    horaInicio = pad2_(horaMatch[1]) + ':' + horaMatch[2];
    horaFim = pad2_(horaMatch[3]) + ':' + (horaMatch[4] || '00');
    raw = raw.replace(horaMatch[0], ' ');
  }

  var tipo = '';
  var tipoMatch = raw.match(/\(([^)]+)\)/);
  if (tipoMatch) {
    tipo = tipoMatch[1].trim();
    raw = raw.replace(tipoMatch[0], ' ');
  }

  var titulo = raw.replace(/\s+/g, ' ').trim();

  if (!tipo) {
    if (/rota\s*\+?\s*miss[ãa]o/i.test(titulo)) tipo = 'Rota';
    else if (/rotinas? da franquia/i.test(titulo)) tipo = 'Rotina';
    else if (/teste de conhecimento|prova/i.test(titulo)) tipo = 'Prova';
    else tipo = 'Estudo Individual';
  } else {
    // Normaliza os rótulos de tipo vindos da planilha para os mesmos usados no resto do sistema.
    var tipoNorm = norm_(tipo);
    if (tipoNorm === 'live') tipo = 'Live';
    else if (tipoNorm === 'curso' || tipoNorm === 'estudo individual') tipo = 'Estudo Individual';
    else if (tipoNorm === 'feriado') tipo = 'Feriado';
  }

  if (!titulo) titulo = tipo;

  return { titulo: titulo, tipo: tipo, horaInicio: horaInicio, horaFim: horaFim };
}

function pad2_(v) {
  v = String(v);
  return v.length < 2 ? ('0' + v) : v;
}

/** Capitaliza a primeira letra (ex.: "segunda" -> "Segunda"). */
function capitalize_(s) {
  s = String(s || '');
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Formata uma célula de data (Date, string ou vazio) como dd/mm/aaaa. */
function formatDateCell_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, 'America/Sao_Paulo', 'dd/MM/yyyy');
  }
  return String(value).trim();
}

/** Formata uma célula de horário (Date/hora, string ou vazio) como HH:mm. */
function formatTimeCell_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, 'America/Sao_Paulo', 'HH:mm');
  }
  return String(value).trim();
}

/** Converte um valor de célula (Date ou string dd/mm/aaaa) em milissegundos, para comparação/ordenação. */
function toDateValue_(value) {
  if (!value) return 0;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  }
  var parts = String(value).split('/');
  if (parts.length === 3) {
    var ano = Number(parts[2]);
    if (ano < 100) ano += 2000; // "26" -> 2026
    return new Date(ano, Number(parts[1]) - 1, Number(parts[0])).getTime();
  }
  return 0;
}

