'use strict';

const $ = (id) => document.getElementById(id);
const canvas = $('map');
const plan = $('plan');
const detail = $('detail');
const dialog = $('dialog');
const form = $('dialogForm');
const width = 684;
const defaultHeight = 1034;
const mapInset = 68;
const tableRadius = 25;
const cloudToken = window.WeddingCloud.readToken(location.hash);
const inCloud = cloudToken !== null;
const storageKey = inCloud ? 'wedding-seating-cloud:' + window.WeddingCloud.project : 'wedding-seating-manual-v6';
let cloudRole = null;
let cloudBusy = false;
let cloudConflict = false;
let cloudMessage = '';
const lastDraftKey = 'wedding-seating-manual-v5';
const importBackupKey = (inCloud ? storageKey : lastDraftKey) + ':before-import';
const sideStorageKey = 'wedding-seating-manual-v4';
const previousStorageKey = 'wedding-seating-manual-v3';
const touchLayout = window.matchMedia('(max-width: 800px)');
const numberLabel = (number) => String(number).padStart(2, '0');
const columns = [63,130,197,351,418,485].map((x) => x + mapInset);
const rows = [132,200,268,336,404,472,540,642,710,778,846];
const sideColumns = [39,645];
const bottomRow = 914;
const reserveSpots = [columns[0],columns[2],columns[3],columns[5]].map((x) => ({x,y:bottomRow}));
const tableSpots = [
  ...rows.flatMap((y) => [...sideColumns,...columns].map((x) => ({x,y}))),
  ...columns.map((x) => ({x,y:bottomRow}))
];
const referenceRows = [
  ['朋友','亲家','亲家','主家','主家',null],
  ['亲戚','亲戚','亲家','主家','亲友桌','朋友'],
  ['亲戚','亲戚','亲戚','嘉宾','嘉宾','嘉宾'],
  ['亲戚','亲戚','亲戚','嘉宾','嘉宾','嘉宾'],
  ['亲戚','亲戚','亲戚','嘉宾','嘉宾','嘉宾'],
  ['亲戚','亲戚','亲戚','宏川','宏川','宏川'],
  ['亲戚','亲戚','亲戚','宏川','宏川','宏川'],
  ['本村','本村','本村','同学','同学','宏川'],
  ['本村','本村','本村','本村','本村','本村'],
  ['本村','本村','本村','本村','本村','本村'],
  ['本村','本村','备桌','备桌','本村','本村']
];

function initialLayout() {
  const zones = [
    {id:'stage', name:'舞台', x:158, y:24, w:232, h:70, style:'stage'},
    {id:'runway', name:'舞台通道', x:248, y:93, w:52, h:210, style:'stage runway'},
    {id:'aisle', name:'主通道 3.5 米', x:237, y:303, w:74, h:590},
    {id:'cross', name:'横向通道 2 米', x:23, y:575, w:502, h:32},
    {id:'sound', name:'控台', x:455, y:105, w:71, h:56},
    {id:'entry', name:'入口 · 缓冲区', x:23, y:891, w:502, h:47, style:'entry'}
  ].map(extendZone).map(adjustBottomZones);
  const tables = [];
  referenceRows.forEach((names,row) => names.forEach((name,col) => {
    if (!name) return;
    const no = tables.length + 1;
    tables.push({id:'t'+no, no, name, seats:12, x:columns[col], y:rows[row]});
  }));
  reserveSpots.forEach((spot) => {
    const no = tables.length + 1;
    tables.push({id:'t'+no, no, name:'备用桌', seats:12, ...spot});
  });
  return {zones, tables, guests:[], imported:false, importIssues:[]};
}

function extendZone(zone) {
  const extendAisle = zone.id === 'cross' && zone.x === 23 && zone.w === 502 && zone.y === 575 && zone.h === 32;
  return extendAisle ? {...zone,w:zone.w + 2 * mapInset} : {...zone,x:zone.x + mapInset};
}

function adjustBottomZones(zone) {
  if (zone.id === 'entry' && zone.x === 23 + mapInset && zone.y === 891 && zone.w === 502 && zone.h === 47) {
    return {...zone,y:959};
  }
  if (zone.id === 'aisle' && zone.x === 237 + mapInset && zone.y === 303 && zone.w === 74 && zone.h === 590) {
    return {...zone,h:656};
  }
  return zone;
}

function migrateBottomRow(previous, fromSideLayout) {
  const reserveIds = new Map(reserveSpots.map((spot,index) => ['t'+(66+index),spot]));
  const tables = previous.tables.map((table) => {
    const position = reserveIds.get(table.id) || {x:table.x + (fromSideLayout ? 0 : mapInset)};
    return {...table,...position};
  });
  const zones = previous.zones.filter((zone) => zone.id !== 'reserves')
    .map((zone) => adjustBottomZones(fromSideLayout ? zone : extendZone(zone)));
  return {...previous,tables,zones};
}

let savedState = {data:initialLayout(),undo:null};
let storedRevision = null;
try {
  const raw = inCloud ? null : localStorage.getItem(storageKey);
  if (raw) {
    const current = JSON.parse(raw);
    if (current?.data) {
      storedRevision = raw;
      savedState = current;
    }
  } else if (!inCloud) {
    const lastDraft = JSON.parse(localStorage.getItem(lastDraftKey));
    const sideLayout = lastDraft ? null : JSON.parse(localStorage.getItem(sideStorageKey));
    const previous = lastDraft || sideLayout || JSON.parse(localStorage.getItem(previousStorageKey));
    if (previous) {
      savedState = {data:lastDraft || migrateBottomRow(previous,Boolean(sideLayout)),undo:null};
      const migrated = JSON.stringify(savedState);
      localStorage.setItem(storageKey,migrated);
      storedRevision = migrated;
    }
  }
} catch {
  // The preview can still open when browser storage is unavailable.
}
let data = structuredClone(savedState.data);

function planHeight() {
  return Math.max(defaultHeight, ...data.tables.map((table) => table.y + tableRadius), ...data.zones.map((zone) => zone.y + zone.h));
}

let selection = data.tables[0] ? {type:'table', id:data.tables[0].id} : null;
let filter = 'all';
let placement = null;
let locatedSeat = null;
let sheetOpen = false;
let swapFrom = null;
let activeDragGuest = null;
let submitDialog = null;
let noticeTimer;
let scale = 1;
let fitScale = 1;
let offset = {x:0, y:0};
let gesture = null;
let mapGestures = false;
let skipMapClickUntil = 0;
const pointers = new Map();

const isReadOnly = () => inCloud ? cloudRole !== 'edit' : location.hash === '#view';
const currentTable = () => selection?.type === 'table' && data.tables.find((table) => table.id === selection.id);
const currentZone = () => selection?.type === 'zone' && data.zones.find((zone) => zone.id === selection.id);
const tableName = (table) => numberLabel(table.no) + ' 号桌' + (table.name ? ' · ' + table.name : '');
const guestAt = (table, seat) => data.guests.find((guest) => guest.tableId === table.id && guest.seat === seat);

function element(tag, className, label) {
  const result = document.createElement(tag);
  result.className = className;
  if (label !== undefined) result.textContent = label;
  return result;
}

function button(label, action, className = 'button') {
  const result = element('button', className, label);
  result.type = 'button';
  if (action) result.addEventListener('click', action);
  return result;
}

function notify(message) {
  const node = $('notice');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { node.hidden = true; },3000);
}

function useSavedState(record, revision) {
  savedState = record;
  storedRevision = revision;
  data = structuredClone(record.data);
}

function persistRecord(record, backupBeforeImport = false) {
  let previousBackup;
  let wroteBackup = false;
  try {
    const latest = localStorage.getItem(storageKey);
    if (latest !== storedRevision) {
      if (latest) useSavedState(JSON.parse(latest),latest);
      else useSavedState({data:initialLayout(),undo:null},null);
      return '另一个窗口刚更新了数据，请重新操作。';
    }
    const revision = JSON.stringify(record);
    if (backupBeforeImport) {
      previousBackup = localStorage.getItem(importBackupKey);
      localStorage.setItem(importBackupKey,JSON.stringify({createdAt:Date.now(),data:savedState.data}));
      wroteBackup = true;
    }
    localStorage.setItem(storageKey,revision);
    useSavedState(record,revision);
    return '';
  } catch {
    if (wroteBackup) {
      try {
        if (previousBackup === null) localStorage.removeItem(importBackupKey);
        else localStorage.setItem(importBackupKey,previousBackup);
      } catch {
        // The current seating arrangement was not replaced.
      }
    }
    data = structuredClone(savedState.data);
    return '浏览器暂时无法保存，已保留上一次成功保存的安排。';
  }
}

function commitChange(next,label,backupBeforeImport = false) {
  if (JSON.stringify(next) === JSON.stringify(savedState.data)) return '';
  const snapshot = structuredClone(next);
  const metadata = inCloud ? {serverRevision:savedState.serverRevision,pending:true} : {};
  return persistRecord({data:snapshot,undo:{data:savedState.data,label},...metadata},backupBeforeImport);
}

function save(message,label) {
  if (isReadOnly()) return false;
  const error = commitChange(data,label || '上一步');
  if (error || message) notify(error || message);
  render();
  return !error;
}

function renderEditorActions() {
  $('editorActions').hidden = isReadOnly();
  const button = $('undoLatest');
  const entry = savedState.undo;
  button.disabled = !entry;
  button.textContent = entry ? '撤销' + entry.label : '撤销上一步';
}

$('savePlan').onclick = () => {
  if (isReadOnly()) return;
  if (inCloud) { syncCloud(); return; }
  const error = persistRecord(savedState);
  render();
  notify(error || '已保存到本机');
};

$('undoLatest').onclick = () => {
  const entry = savedState.undo;
  if (!entry || isReadOnly()) return;
  const metadata = inCloud ? {serverRevision:savedState.serverRevision,pending:true} : {};
  const error = persistRecord({data:entry.data,undo:null,...metadata});
  if (!currentTable() && !currentZone()) selection = null;
  locatedSeat = null;
  render();
  if (entry.label.includes('导入') || entry.label.includes('恢复')) fit();
  notify(error || '已撤销' + entry.label);
};

const deskTones = [
  [0,47], [23,65], [42,60], [61,44], [87,43], [118,41], [151,47],
  [177,45], [200,53], [223,53], [250,48], [275,48], [305,42], [332,53],
  [30,27], [205,27]
];

function deskGroup(table) {
  return table.name?.trim() || '未命名';
}

function describeDesks() {
  const groups = new Map();
  for (const table of data.tables) {
    const name = deskGroup(table);
    if (!groups.has(name)) groups.set(name,{name,count:0});
    groups.get(name).count++;
  }
  const used = new Set();
  for (const group of groups.values()) {
    if (group.name === '未命名') {
      group.tone = [45,12];
      continue;
    }
    let hash = 0;
    for (const char of group.name) hash = (Math.imul(hash,31) + char.codePointAt(0)) >>> 0;
    let tone = hash % deskTones.length;
    for (let step = 0; step < deskTones.length && used.has(tone); step++) tone = (tone + 1) % deskTones.length;
    used.add(tone);
    group.tone = deskTones[tone];
  }
  return groups;
}

function applyDeskTone(node, [hue,saturation]) {
  node.style.setProperty('--desk-tone', hue + ' ' + saturation + '%');
}

function renderDeskSummary(groups) {
  $('deskSummaryTotal').textContent = '共 ' + data.tables.length + ' 桌';
  const stats = [...groups.values()].sort((a,b) => b.count - a.count || a.name.localeCompare(b.name,'zh-CN'));
  $('deskSummaryEmpty').hidden = stats.length > 0;
  $('deskSummary').replaceChildren(...stats.map(({name,count,tone}) => {
    const item = element('li','desk-stat');
    const label = element('span','desk-stat-name',name);
    label.title = name;
    const total = element('span','desk-stat-total');
    total.append(element('strong','',count),' 桌');
    item.append(label,total);
    applyDeskTone(item,tone);
    return item;
  }));
}

function render() {
  renderEditorActions();
  renderCloudStatus();
  const readOnly = isReadOnly();
  $('editLink').toggleAttribute('aria-current', !readOnly);
  $('viewLink').toggleAttribute('aria-current', readOnly);
  $(readOnly ? 'viewLink' : 'editLink').setAttribute('aria-current', 'page');
  $('mapActions').hidden = readOnly;
  $('pageHint').textContent = readOnly ? '点圆桌查看座位，或按姓名查找' : '按参考图排列 · 拖动圆桌自动对齐';
  $('addGuest').hidden = readOnly;
  $('quickAddGuest').hidden = readOnly;
  $('importGuests').hidden = readOnly;
  $('restoreImport').hidden = readOnly || !readImportBackup();
  const unseated = data.guests.filter((guest) => !guest.tableId).length;
  $('dataStatus').textContent = (data.imported ? '名单仅存于当前浏览器' : '参考图 65 桌 ＋ 最后一排 4 张备用桌 · 可导入本地 Excel 名单') + (data.importIssues.length ? ' · ' + data.importIssues.length + ' 处名单记录待核对' : '');
  const metrics = [
    [data.tables.length, '张桌'],
    [data.tables.reduce((sum, table) => sum + table.seats, 0), '个座位'],
    [data.guests.length - unseated, '人已安排'],
    ...(unseated ? [[unseated, '人待安排']] : [])
  ];
  $('summary').replaceChildren(...metrics.map(([count, label]) => {
    const stat = label === '人待安排'
      ? button('', () => openGuestList('unseated'), 'stat stat-button')
      : element('div', 'stat');
    stat.append(element('b', '', count), label);
    return stat;
  }));
  const deskGroups = describeDesks();
  renderDeskSummary(deskGroups);
  renderGuestList();
  renderMap(deskGroups);
  renderDetail();
  renderMapHint();
}

function renderMapHint() {
  canvas.classList.toggle('is-placing', Boolean(placement || swapFrom));
  canvas.classList.toggle('is-manipulating',mapGestures);
  const gestureToggle = $('mapGestureToggle');
  gestureToggle.hidden = !touchLayout.matches;
  gestureToggle.setAttribute('aria-pressed',String(mapGestures));
  gestureToggle.textContent = mapGestures ? '完成操作' : '操作地图';
  $('cancelSwap').hidden = !swapFrom;
  $('cancelPlacement').hidden = !placement;
  $('mapHint').textContent = placement
    ? '在图上点选位置，按 Esc 取消'
    : swapFrom ? '请选择要互换的另一桌' : (touchLayout.matches
      ? (mapGestures ? '可拖动地图或双指缩放' : '可上下滑动页面 · 点桌看名单')
      : '点桌看名单 · 拖桌自动对齐');
  $('addTable').textContent = placement?.type === 'newTable' ? '取消放置' : '＋ 圆桌';
}

function showDetail(open) {
  sheetOpen = open && touchLayout.matches;
  detail.toggleAttribute('data-open', sheetOpen);
  $('detailBackdrop').hidden = !sheetOpen;
  document.body.classList.toggle('sheet-open', sheetOpen);
  if (sheetOpen) {
    detail.scrollTop = 0;
    detail.querySelector('.close-detail')?.focus({preventScroll:true});
  }
}

function snapTable(x, y) {
  const match = tableSpots.reduce((nearest, spot) => {
    const distance = Math.hypot(x - spot.x, y - spot.y);
    return distance < nearest.distance ? {...spot,distance} : nearest;
  }, {distance:40});
  return match.x === undefined ? null : match;
}

function selectTable(table) {
  if (!swapFrom || isReadOnly()) {
    select('table',table.id);
    return;
  }
  const first = data.tables.find((item) => item.id === swapFrom);
  if (!first || first === table) {
    renderMapHint();
    return;
  }
  swapFrom = null;
  renderMapHint();
  confirmDialog('交换两桌', '交换 ' + numberLabel(first.no) + ' 号桌和 ' + numberLabel(table.no) + ' 号桌的桌名、椅子和宾客。地图上的桌号保持原位。', '确认交换', () => {
    for (const guest of data.guests) {
      if (guest.tableId === first.id) guest.tableId = table.id;
      else if (guest.tableId === table.id) guest.tableId = first.id;
    }
    [first.name, table.name] = [table.name, first.name];
    [first.seats, table.seats] = [table.seats, first.seats];
    selection = {type:'table',id:table.id};
    locatedSeat = null;
    save('两桌已互换','换桌');
    showDetail(true);
  });
}

function startSwap(table) {
  placement = null;
  swapFrom = table.id;
  showDetail(false);
  renderMapHint();
  if (touchLayout.matches) canvas.scrollIntoView({block:'center'});
}

function renderGuestList() {
  const search = $('guestSearch').value.trim().toLowerCase();
  const listed = new Map();
  for (const guest of data.guests) {
    if (filter === 'unseated' && guest.tableId) continue;
    if (!(guest.name + ' ' + guest.group).toLowerCase().includes(search)) continue;
    const key = JSON.stringify([guest.partyId || guest.id, guest.tableId]);
    if (!listed.has(key)) listed.set(key, []);
    listed.get(key).push(guest);
  }
  $('guestSubtitle').textContent = data.guests.length + ' 人 · ' + data.guests.filter((guest) => !guest.tableId).length + ' 人待安排';
  for (const node of document.querySelectorAll('[data-filter]')) {
    node.setAttribute('aria-pressed', String(node.dataset.filter === filter));
  }
  const items = [...listed.values()].map((guests) => {
    guests.sort((a,b) => a.seat - b.seat);
    const first = guests[0];
    const row = element('div','guest');
    row.dataset.group = first.group;
    const table = data.tables.find((item) => item.id === first.tableId);
    const findSeat = () => {
      if (table) locate(table,first.seat);
      else if (isReadOnly()) notify('这组宾客还有 ' + guests.length + ' 人待安排。');
      else openPartyPlacement(first);
    };
    const person = button('', findSeat, 'guest-person');
    person.append(element('span','avatar',Array.from(first.name)[0]));
    const labels = element('span','');
    labels.append(element('strong','',first.name + (guests.length > 1 ? ' · ' + guests.length + ' 人' : '')));
    const seats = table ? ' · ' + numberLabel(table.no) + ' 桌 ' + guests.map((item) => numberLabel(item.seat)).join('、') + ' 椅' : ' · 待安排';
    labels.append(element('small','',(first.group || '未分组') + seats));
    person.append(labels);
    row.append(person);
    if (!isReadOnly()) {
      const actions = element('div','guest-row-actions');
      if (!table) actions.append(button(first.needsName ? '补称呼' : '去排座',findSeat,'locate'));
      if (guests.length === 1) enableGuestDrag(person,first);
      actions.append(button('编辑',() => guests.length === 1 ? editGuest(first) : editParty(first),'locate'));
      row.append(actions);
    }
    return row;
  });
  $('guestList').replaceChildren(...(items.length ? items : [element('p','empty',search ? '没有找到相关宾客。' : '这里暂时没有宾客。')]));
}

function editParty(first) {
  const party = data.guests.filter((guest) => guest.partyId === first.partyId);
  const fields = [input('称呼','name',first.name,{maxLength:40}),input('分组','group',first.group,{required:false,maxLength:24})];
  openDialog('编辑同行称呼',fields,'保存',(values) => {
    const name = values.get('name').trim();
    if (!name) return '请填写称呼。';
    for (const guest of party) Object.assign(guest,{name,group:values.get('group').trim(),needsName:name === '待补称呼'});
    save('称呼已更新','编辑宾客');
    return '';
  });
}

function renderMap(groups = describeDesks()) {
  const counts = new Map();
  data.guests.forEach(({tableId}) => counts.set(tableId, (counts.get(tableId) || 0) + 1));
  const zones = data.zones.map((zone) => {
    const interactive = !isReadOnly();
    const node = interactive
      ? button(zone.name, () => select('zone', zone.id), 'zone')
      : element('div', 'zone', zone.name);
    if (zone.style) node.classList.add(...zone.style.split(' '));
    if (interactive) node.dataset.zoneId = zone.id;
    node.classList.toggle('is-selected', currentZone()?.id === zone.id);
    for (const [property, value] of [['left',zone.x],['top',zone.y],['width',zone.w],['height',zone.h]]) {
      node.style[property] = value + 'px';
    }
    return node;
  });
  const tables = data.tables.map((table) => {
    const occupied = counts.get(table.id) || 0;
    const node = button(numberLabel(table.no), () => selectTable(table), 'table-marker');
    node.dataset.tableId = table.id;
    applyDeskTone(node, groups.get(deskGroup(table)).tone);
    node.classList.toggle('occupied', occupied > 0);
    node.classList.toggle('is-selected', currentTable()?.id === table.id);
    node.setAttribute('aria-pressed', String(currentTable()?.id === table.id));
    node.setAttribute('aria-label', tableName(table) + '，' + occupied + ' / ' + table.seats + ' 人');
    node.title = tableName(table);
    node.style.left = table.x + 'px';
    node.style.top = table.y + 'px';
    node.append(element('span', 'marker-name', deskGroup(table)), element('small', '', occupied + '/' + table.seats + ' 人'));
    return node;
  });
  plan.replaceChildren(...zones, ...tables);
}

function select(type, id, jump = true, seat = null) {
  locatedSeat = seat;
  selection = {type, id};
  renderMap();
  renderDetail();
  if (jump) showDetail(true);
}

function locate(table, seat) {
  scale = Math.max(scale, fitScale * 1.65);
  const mapRect = canvas.getBoundingClientRect();
  if (touchLayout.matches) window.scrollTo(0, window.scrollY + mapRect.top - 12);
  offset = {x:canvas.clientWidth / 2 - table.x * scale, y:canvas.clientHeight * (touchLayout.matches ? 0.31 : 0.5) - table.y * scale};
  applyTransform();
  select('table', table.id, true, seat);
}

function sectionTitle(title, subtitle, action, secondary) {
  const heading = element('div', 'panel-heading');
  const text = element('div', '');
  text.append(element('h2', '', title), element('p', '', subtitle));
  heading.append(text);
  const close = button('×', () => showDetail(false), 'icon-button close-detail');
  close.setAttribute('aria-label', '关闭桌位详情');
  const actions = element('div', 'detail-heading-actions');
  if (action) actions.append(action);
  if (secondary) actions.append(secondary);
  actions.append(close);
  heading.append(actions);
  return heading;
}

function renderDetail() {
  const table = currentTable();
  const zone = currentZone();
  if (!table) {
    if (zone && !isReadOnly()) {
      const actions = element('div', 'detail-actions');
      actions.append(
        button('在图上移动', () => beginPlacement({type:'moveZone', id:zone.id})),
        button('删除留空区', () => deleteZone(zone), 'button danger')
      );
      detail.replaceChildren(
        sectionTitle(zone.name, '留空区 · 可调整大小和位置', button('编辑区域', () => editZone(zone))),
        actions
      );
    } else {
      detail.replaceChildren(sectionTitle('桌位详情', '点地图上的圆桌查看座位。'));
    }
    return;
  }

  const editable = !isReadOnly();
  const used = data.guests.filter((guest) => guest.tableId === table.id).length;
  const located = locatedSeat && guestAt(table, locatedSeat);
  const heading = sectionTitle(tableName(table), used + ' 人已坐 · ' + (table.seats - used) + ' 个空位',
    editable ? button('编辑桌位', () => editTable(table)) : null,
    editable ? button('换桌', () => startSwap(table)) : null);
  const diagram = element('div', 'seat-diagram');
  diagram.classList.toggle('dense', table.seats > 14);
  if (table.seats > 12) diagram.style.setProperty('--pin-width', (38 * Math.sin(2 * Math.PI / table.seats)) + '%');
  const circle = element('div', 'seat-table');
  const deskName = table.name || '未命名';
  circle.append(element('strong', '', deskName), element('small', '', table.seats + ' 把椅子'));
  circle.title = deskName;
  diagram.append(circle);
  const roster = element('div', 'seat-roster');
  const rosterGroups = new Set();
  for (let seat = 1; seat <= table.seats; seat++) {
    const guest = guestAt(table, seat);
    const emphasized = locatedSeat === seat || Boolean(guest?.partyId && located?.partyId === guest.partyId);
    const label = numberLabel(seat);
    const occupantName = guest?.name || '空位';
    const seatDescription = label + ' 号椅 · ' + occupantName;
    const action = editable ? () => editSeat(table, seat) : guest ? () => notify(seatDescription) : null;
    const pin = button('', action, 'seat-pin');
    pin.append(element('span', 'seat-name', occupantName));
    const angle = ((seat - 1) / table.seats) * Math.PI * 2 - Math.PI / 2;
    pin.style.left = 50 + Math.cos(angle) * 39 + '%';
    pin.style.top = 50 + Math.sin(angle) * 38 + '%';
    pin.classList.toggle('taken', Boolean(guest));
    pin.classList.toggle('located', emphasized);
    pin.disabled = !action;
    pin.title = seatDescription;
    pin.setAttribute('aria-label', pin.title);
    diagram.append(pin);

    if (editable) enableSeatDrop(pin, table, seat);
    const key = guest && partyKey(guest);
    if (key && rosterGroups.has(key)) continue;
    if (key) rosterGroups.add(key);
    const memberSeats = guest ? data.guests.filter((item) => item.tableId === table.id && partyKey(item) === key).map((item) => item.seat).sort((a,b) => a-b) : [seat];
    const isGroup = memberSeats.length > 1;
    const item = button('', action, isGroup ? 'seat-row group-row' : 'seat-row');
    item.dataset.seat = seat;
    item.disabled = !action;
    item.classList.toggle('located', emphasized);
    const seatLabels = memberSeats.map(numberLabel).join('、');
    const name = guest ? guest.name + (isGroup ? ' · ' + memberSeats.length + ' 人' : '') : '空位';
    item.append(element('span', '', seatLabels), element('strong', '', name));
    item.title = name + ' · ' + seatLabels + ' 号椅';
    item.setAttribute('aria-label', item.title);
    roster.append(item);
    if (editable) {
      enableSeatDrop(item, table, seat);
      if (guest) enableGuestDrag(item, guest);
    }
  }
  detail.replaceChildren(heading, diagram, roster);
  if (editable) {
    const actions = element('div', 'detail-actions');
    actions.append(
      button('在图上移动', () => beginPlacement({type:'moveTable', id:table.id})),
      button('删除圆桌', () => deleteTable(table), 'button danger')
    );
    detail.append(actions);
  }
}

function input(label, name, value, options = {}) {
  const wrapper = element('label', '', label);
  const node = element('input', '');
  Object.assign(node, {name, value, required:true, ...options});
  wrapper.append(node);
  return wrapper;
}

function openDialog(title, fields, saveLabel, onSubmit, alternateLabel = '') {
  $('dialogTitle').textContent = title;
  $('dialogFields').replaceChildren(...fields);
  $('dialogError').textContent = '';
  $('dialogSave').textContent = saveLabel;
  $('dialogSave').disabled = false;
  $('dialogAlternateSave').hidden = !alternateLabel;
  $('dialogAlternateSave').textContent = alternateLabel;
  submitDialog = onSubmit;
  if (!dialog.open) dialog.showModal();
}

function confirmDialog(title, message, label, action) {
  openDialog(title, [element('p', '', message)], label, () => {
    action();
    return '';
  });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (isReadOnly() || !submitDialog) return;
  const submit = submitDialog;
  submitDialog = null;
  const error = submit(new FormData(form), event.submitter);
  if (error) {
    $('dialogError').textContent = error;
    submitDialog = submit;
  } else if (!submitDialog) {
    dialog.close();
  }
});

$('closeDialog').onclick = $('cancelDialog').onclick = () => dialog.close();

function id(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function openPartyPlacement(guest) {
  if (isReadOnly()) return;
  if (guest.needsName) {
    const group = wholeParty(guest);
    if (group.length > 1) editParty(guest);
    else editGuest(guest);
    return;
  }
  const group = wholeParty(guest);
  const usedSeats = new Map();
  for (const member of data.guests) {
    if (!member.tableId || partyKey(member) === partyKey(guest)) continue;
    usedSeats.set(member.tableId,(usedSeats.get(member.tableId) || 0) + 1);
  }
  const candidates = [...data.tables].sort((a,b) => a.no - b.no)
    .filter((table) => table.seats - (usedSeats.get(table.id) || 0) >= group.length);
  const title = '安排 ' + guest.name + ' · ' + group.length + ' 人';
  if (!candidates.length) {
    openDialog(title,[element('p','','现在没有一桌能坐下这组宾客。可以调整桌位后再试。')],'知道了',() => '');
    return;
  }

  const choice = element('label','','选择桌位');
  const selectDesk = element('select','');
  selectDesk.name = 'desk';
  selectDesk.required = true;
  selectDesk.append(new Option('请选择桌位',''));
  for (const desk of candidates) selectDesk.append(new Option(tableName(desk) + ' · 余 ' + (desk.seats - (usedSeats.get(desk.id) || 0)) + ' 位',desk.id));
  choice.append(selectDesk);
  openDialog(title,[choice],'确认排座',(values) => {
    const table = data.tables.find((desk) => desk.id === values.get('desk'));
    if (!table) return '请重新选择桌位。';
    const seat = Array.from({length:table.seats},(_,index) => index + 1).find((index) => {
      const occupant = guestAt(table,index);
      return !occupant || partyKey(occupant) === partyKey(guest);
    });
    if (!seat) return '这桌已经满了，请换一桌。';
    const error = assignParty(guest,table.id,seat);
    if (!error) {
      const seated = data.guests.find((member) => member.id === guest.id);
      if (seated?.tableId === table.id) locate(table,seated.seat);
    }
    return error;
  });
  selectDesk.focus();
}

function editGuest(guest) {
  if (isReadOnly()) return;
  const nameField = input('称呼或姓名', 'name', guest?.name || '', {maxLength:40});
  const groupField = input('分组（可选）','group',guest?.group || '',{required:false,maxLength:24,placeholder:'例如亲友、同学'});
  const nameInput = nameField.querySelector('input');
  const duplicateWarning = element('div','duplicate-warning');
  const duplicateChoice = element('label','duplicate-opt-in');
  const checkbox = element('input','');
  checkbox.type = 'checkbox';
  checkbox.name = 'confirmSame';
  duplicateChoice.append(checkbox, '这是不同的宾客，仍然保存');
  duplicateWarning.append(element('p','','名单里已有相同称呼，请确认是不是同一人。'),duplicateChoice);
  const isDuplicate = (name) => Boolean(name && data.guests.some((candidate) => candidate.id !== guest?.id && candidate.name.trim() === name) && name !== guest?.name);
  const showDuplicate = () => { duplicateWarning.hidden = !isDuplicate(nameInput.value.trim()); };
  nameInput.addEventListener('input',() => { checkbox.checked = false; showDuplicate(); });
  const countField = input('人数（含本人）','headcount','1',{type:'number',min:1,max:2000,step:1,inputMode:'numeric'});
  const fields = guest ? [nameField,groupField,duplicateWarning] : [nameField,countField,groupField,duplicateWarning];
  if (guest) {
    fields.push(button('删除宾客', () => confirmDialog('删除宾客', '将删除 ' + guest.name + '，如果已有安排，对应椅子将空出。', '删除', () => {
      data.guests = data.guests.filter((candidate) => candidate.id !== guest.id);
      save('已删除宾客','删除宾客');
    }), 'button danger'));
  }
  openDialog(guest ? '编辑宾客' : '添加宾客', fields, '保存', (values,submitter) => {
    const name = values.get('name').trim();
    if (!name) return '请填写宾客称呼或姓名。';
    if (isDuplicate(name) && !values.has('confirmSame')) { showDuplicate(); return '请确认是否另加一条同名记录。'; }
    const group = values.get('group').trim();
    if (guest) {
      Object.assign(guest,{name,group,needsName:name === '待补称呼'});
      save('宾客已更新','编辑宾客');
      return '';
    }
    const count = Number(values.get('headcount'));
    if (!Number.isInteger(count) || count < 1 || count > 2000) return '请输入有效的同行人数。';
    const added = waitingGuests([{id:id('g'),name,group,count,needsName:false}]);
    data.guests.unshift(...added);
    if (!save('已添加 ' + count + ' 人','添加宾客')) return '本次添加未保存，请重试。';
    if (submitter === $('dialogAlternateSave')) openPartyPlacement(added[0]);
    return '';
  },guest ? '' : '保存并排座');
  showDuplicate();
  nameInput.focus();
}

function enableGuestDrag(node, guest) {
  node.draggable = true;
  node.ondragstart = (event) => {
    activeDragGuest = guest.id;
    event.dataTransfer.setData('text/plain', guest.id);
    event.dataTransfer.effectAllowed = 'move';
  };
  node.ondragend = () => { activeDragGuest = null; };
}

function enableSeatDrop(node, table, seat) {
  node.ondragover = (event) => {
    if (!activeDragGuest) return;
    event.preventDefault();
    node.classList.add('drop-target');
  };
  node.ondragleave = () => node.classList.remove('drop-target');
  node.ondrop = (event) => {
    event.preventDefault();
    node.classList.remove('drop-target');
    const guest = data.guests.find(({id: guestId}) => guestId === activeDragGuest);
    activeDragGuest = null;
    if (guest && !isReadOnly()) {
      const error = assignParty(guest,table.id,seat);
      if (error) notify(error);
    }
  };
}

function partyKey(guest) {
  return guest.partyId || guest.id;
}

function wholeParty(guest) {
  const key = partyKey(guest);
  return data.guests.filter((item) => partyKey(item) === key).sort((a,b) => (a.ordinal || 1) - (b.ordinal || 1));
}

function editSeat(table, seat) {
  const original = guestAt(table, seat);
  const field = input('搜索宾客','query','',{type:'search',required:false,placeholder:'输入姓名或称呼中的任意一个字',autocomplete:'off'});
  const query = field.querySelector('input');
  const results = element('div','party-results');
  const chosen = element('p','party-chosen');
  chosen.setAttribute('aria-live','polite');
  const hint = element('p','party-hint');
  hint.setAttribute('aria-live','polite');
  const parties = new Map();
  for (const guest of data.guests) {
    if (guest.needsName) continue;
    if (!parties.has(partyKey(guest))) parties.set(partyKey(guest),guest);
  }
  let selected = null;
  function draw() {
    const term = query.value.trim().toLowerCase();
    const matches = term ? [...parties.values()].filter((guest) => guest.name.toLowerCase().includes(term)) : [];
    hint.textContent = !term ? '输入一个字即可查找宾客。' : matches.length ? '' : '没有找到符合条件的宾客。';
    results.hidden = !matches.length;
    results.replaceChildren(...matches.map((guest) => {
      const group = wholeParty(guest);
      const assigned = data.tables.find((candidate) => candidate.id === guest.tableId);
      const label = guest.name + ' · ' + group.length + ' 人';
      const option = button('', () => {
        selected = guest;
        chosen.textContent = '已选：' + label;
        $('dialogError').textContent = '';
        for (const result of results.children) result.setAttribute('aria-pressed',String(result === option));
        $('dialogSave').disabled = false;
        query.blur();
      }, 'party-result');
      const status = [guest.group, assigned ? numberLabel(assigned.no) + ' 号桌' : '待安排'].filter(Boolean).join(' · ');
      option.setAttribute('aria-pressed',String(selected === guest));
      option.append(element('strong','',label),element('small','',status));
      return option;
    }));
  }
  query.addEventListener('input', () => {
    selected = null;
    chosen.textContent = '';
    $('dialogError').textContent = '';
    $('dialogSave').disabled = true;
    draw();
  });
  const fields = [field,hint,results,chosen];
  if (original) fields.unshift(element('p','current-seat-name','当前宾客：' + original.name));
  if (original) fields.push(button('整组移出本桌', () => {
    const group = wholeParty(original);
    confirmDialog('移出本桌', '将「' + original.name + '」共 ' + group.length + ' 人放回待安排名单。', '确认移出', () => {
      group.forEach(clearSeat);
      save('整组已移出本桌','移出宾客');
    });
  },'button danger'));
  openDialog(tableName(table) + ' · ' + numberLabel(seat) + ' 号椅',fields,'保存',(values) => {
    if (!selected) return '请先点选一条搜索结果。';
    return assignParty(selected,table.id,seat);
  });
  $('dialogSave').disabled = true;
  draw();
}

function assignParty(guest, tableId, seat) {
  const current = data.guests.find((item) => item.id === guest.id);
  const table = data.tables.find((item) => item.id === tableId);
  if (!current || !table || seat > table.seats) return '名单或桌位已有变化，请重新选择。';
  if (current.needsName) return '请先给这组宾客补上称呼。';
  const group = wholeParty(current);
  const currentIds = new Set(group.map((item) => item.id));
  const displaced = guestAt(table,seat);
  if (displaced && !currentIds.has(displaced.id)) {
    if (group.length === 1 && wholeParty(displaced).length === 1) {
      confirmSeatChange(current,table,seat);
      return '';
    }
    return '这把椅子已有宾客，请从同桌的空椅开始安排。';
  }

  const clockwise = Array.from({length:table.seats}, (_,i) => ((seat - 1 + i) % table.seats) + 1);
  const available = new Set(clockwise.filter((number) => {
    const occupant = guestAt(table,number);
    return !occupant || currentIds.has(occupant.id);
  }));
  if (available.size < group.length) return '这组有 ' + group.length + ' 人，本桌可用 ' + available.size + ' 位，还差 ' + (group.length - available.size) + ' 位。';

  let seats = clockwise.filter((number) => available.has(number)).slice(0,group.length);
  for (const start of clockwise) {
    const run = Array.from({length:group.length}, (_,i) => ((start - 1 + i) % table.seats) + 1);
    if (run.includes(seat) && run.every((number) => available.has(number))) {
      seats = run;
      break;
    }
  }
  const message = '已安排 ' + group.length + ' 人到 ' + numberLabel(table.no) + ' 号桌';
  group.forEach((item,index) => Object.assign(item,{tableId:table.id,seat:seats[index]}));
  return save(message,'排座') ? '' : '本次座位变动未保存，请重试。';
}

function clearSeat(guest) {
  Object.assign(guest, {tableId:null, seat:null});
}

function confirmSeatChange(guest, table, seat) {
  const displaced = guestAt(table, seat);
  if (displaced === guest) return;
  const apply = () => {
    if (displaced) {
      displaced.tableId = guest.tableId;
      displaced.seat = guest.seat;
    }
    Object.assign(guest, {tableId:table.id, seat});
    save('座位已更新','换座');
  };
  if (!displaced) {
    apply();
    return;
  }
  const message = guest.tableId
    ? '将交换 ' + guest.name + ' 与 ' + displaced.name + ' 的座位。'
    : '将安排 ' + guest.name + ' 入座，' + displaced.name + ' 回到未安排名单。';
  confirmDialog('这把椅子已有宾客', message, guest.tableId ? '交换座位' : '确认调整', apply);
}

function editTable(table) {
  const fields = [
    input('桌号', 'no', table.no, {type:'number', min:1, max:999}),
    input('桌名', 'name', table.name, {required:false, maxLength:20, placeholder:'例如主桌、同学桌'}),
    input('椅子数量', 'seats', table.seats, {type:'number', min:1, max:20})
  ];
  openDialog('编辑桌位', fields, '保存', (values) => {
    const no = Number(values.get('no'));
    if (data.tables.some((other) => other !== table && other.no === no)) return '这个桌号已经在使用。';
    const seats = Number(values.get('seats'));
    const name = values.get('name').trim();
    const affectedIds = new Set(data.guests.filter((guest) => guest.tableId === table.id && guest.seat > seats).map(partyKey));
    const affected = data.guests.filter((guest) => guest.tableId === table.id && affectedIds.has(partyKey(guest)));
    const apply = () => {
      affected.forEach(clearSeat);
      Object.assign(table, {no, name, seats});
      save('桌位已更新','编辑桌位');
    };
    if (affected.length) {
      confirmDialog('减少椅子', '有 ' + affected.length + ' 位宾客会整组回到未安排名单。', '确认减少', apply);
    } else {
      apply();
    }
    return '';
  });
}

function deleteTable(table) {
  const affected = data.guests.filter((guest) => guest.tableId === table.id);
  const message = '将移除 ' + tableName(table) + '。' + (affected.length ? affected.length + ' 位宾客会回到未安排名单。' : '');
  confirmDialog('删除圆桌', message, '删除', () => {
    affected.forEach(clearSeat);
    data.tables = data.tables.filter((item) => item.id !== table.id);
    selection = null;
    save('已删除圆桌','删除圆桌');
  });
}

function editZone(zone) {
  const fields = [
    input('区域名称', 'name', zone?.name || '', {maxLength:24, placeholder:'例如通道、舞台、控台'}),
    input('区域宽度', 'w', zone?.w || 60, {type:'number', min:20, max:700}),
    input('区域高度', 'h', zone?.h || 45, {type:'number', min:18, max:690})
  ];
  openDialog(zone ? '编辑留空区' : '新增留空区', fields, zone ? '保存' : '在图上放置', (values) => {
    const props = {name:values.get('name').trim(), w:Number(values.get('w')), h:Number(values.get('h'))};
    if (!props.name) return '请填写区域名称。';
    if (!zone) {
      beginPlacement({type:'newZone', props});
    } else {
      const proposal = {...zone, ...props};
      if (!canPlaceZone(proposal)) return '区域太大、超出场地或会挡住桌位，请调整后再保存。';
      Object.assign(zone, props);
      save('留空区已更新','编辑留空区');
    }
    return '';
  });
}

function deleteZone(zone) {
  confirmDialog('删除留空区', '将移除「' + zone.name + '」的区域标记。', '删除', () => {
    data.zones = data.zones.filter((item) => item.id !== zone.id);
    selection = null;
    save('已删除留空区','删除留空区');
  });
}

function overlapsZone(x, y, zone) {
  const nearestX = Math.max(zone.x, Math.min(x, zone.x + zone.w));
  const nearestY = Math.max(zone.y, Math.min(y, zone.y + zone.h));
  return Math.hypot(x - nearestX, y - nearestY) < tableRadius;
}

function canPlaceZone(zone) {
  return zone.x >= 0 && zone.y >= 0 && zone.x + zone.w <= width && zone.y + zone.h <= planHeight() &&
    !data.tables.some((table) => overlapsZone(table.x, table.y, zone));
}

function canPlaceTable(x, y, except) {
  return x >= tableRadius && y >= tableRadius && x <= width - tableRadius && y <= planHeight() - tableRadius &&
    !data.zones.some((zone) => overlapsZone(x, y, zone)) &&
    !data.tables.some((table) => table.id !== except && Math.hypot(table.x - x, table.y - y) < tableRadius * 2);
}

function beginPlacement(next) {
  placement = next;
  if (next) { swapFrom = null; showDetail(false); }
  $('cancelSwap').hidden = !swapFrom;
  renderMapHint();
  if (next && touchLayout.matches) canvas.scrollIntoView({block:'center'});
}

function placeAt(x, y) {
  const position = placement;
  if (position.type === 'moveZone' || position.type === 'newZone') {
    const existing = data.zones.find((zone) => zone.id === position.id);
    const zone = {...(existing || position.props)};
    zone.x = Math.round(x - zone.w / 2);
    zone.y = Math.round(y - zone.h / 2);
    if (!canPlaceZone(zone)) {
      notify('区域超出场地或挡住了桌位，请换个位置。');
      return;
    }
    if (existing) Object.assign(existing, zone);
    else {
      zone.id = id('z');
      data.zones.push(zone);
    }
    selection = {type:'zone', id:zone.id};
  } else {
    const spot = snapTable(x, y);
    if (!spot) { notify('请把圆桌放到对齐的桌位上。'); return; }
    x = spot.x;
    y = spot.y;
    if (!canPlaceTable(x, y, position.id)) {
      notify('这里放不下圆桌，请避开通道、留空区和其他桌子。');
      return;
    }
    let table = data.tables.find((item) => item.id === position.id);
    if (!table) {
      table = {id:id('t'), no:Math.max(0, ...data.tables.map((item) => item.no)) + 1, seats:12, name:''};
      data.tables.push(table);
    }
    Object.assign(table, {x, y});
    selection = {type:'table', id:table.id};
  }
  placement = null;
  const labels = {newTable:'添加圆桌',moveTable:'移动圆桌',newZone:'添加留空区',moveZone:'移动留空区'};
  save('场地布局已更新',labels[position.type]);
}

function localPoint(event) {
  const bounds = canvas.getBoundingClientRect();
  return {x:event.clientX - bounds.left, y:event.clientY - bounds.top};
}

function applyTransform() {
  plan.style.transform = 'translate(' + offset.x + 'px, ' + offset.y + 'px) scale(' + scale + ')';
  $('zoomLabel').textContent = Math.round(scale / fitScale * 100) + '%';
}

function fit() {
  const height = planHeight();
  plan.style.height = height + 'px';
  fitScale = Math.min((canvas.clientWidth - 22) / width, (canvas.clientHeight - 22) / height);
  scale = fitScale;
  offset = {x:(canvas.clientWidth - width * scale) / 2, y:(canvas.clientHeight - height * scale) / 2};
  applyTransform();
}

function zoomAt(next, point, origin = point) {
  const constrained = Math.min(Math.max(next, fitScale * 0.75), Math.max(fitScale * 5.5, 2));
  const factor = constrained / scale;
  offset = {x:point.x - (origin.x - offset.x) * factor, y:point.y - (origin.y - offset.y) * factor};
  scale = constrained;
  applyTransform();
}

function pinchPoint() {
  const [first, second] = pointers.values();
  return {x:(first.x + second.x) / 2, y:(first.y + second.y) / 2, distance:Math.max(1, Math.hypot(first.x - second.x, first.y - second.y))};
}

canvas.addEventListener('wheel', (event) => {
  if (event.ctrlKey || event.deltaY !== 0) {
    event.preventDefault();
    zoomAt(scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), localPoint(event));
  }
}, {passive:false});

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || (event.pointerType === 'touch' && touchLayout.matches && !mapGestures)) return;
  const point = localPoint(event);
  pointers.set(event.pointerId, point);
  if (pointers.size >= 2) {
    if (gesture?.type === 'drag') renderMap();
    gesture = {type:'pinch', previous:pinchPoint()};
    return;
  }
  const marker = event.target.closest('[data-table-id], [data-zone-id]');
  const drag = marker && event.pointerType === 'mouse' && !isReadOnly() && !placement && !swapFrom;
  gesture = {type:drag ? 'drag' : 'pan', start:point, offset:{...offset}, marker, started:false};
});

canvas.addEventListener('pointermove', (event) => {
  if (!gesture || !pointers.has(event.pointerId)) return;
  const point = localPoint(event);
  pointers.set(event.pointerId, point);
  if (gesture.type === 'pinch') {
    if (pointers.size < 2) return;
    const previous = gesture.previous;
    const next = pinchPoint();
    zoomAt(scale * next.distance / previous.distance, next, previous);
    gesture.previous = next;
    return;
  }
  const dx = point.x - gesture.start.x;
  const dy = point.y - gesture.start.y;
  if (!gesture.started && Math.hypot(dx, dy) < 5) return;
  if (!gesture.started) {
    canvas.setPointerCapture(event.pointerId);
    gesture.started = true;
  }
  if (gesture.type === 'pan') {
    offset = {x:gesture.offset.x + dx, y:gesture.offset.y + dy};
    applyTransform();
  } else {
    gesture.marker.style.translate = dx / scale + 'px ' + dy / scale + 'px';
  }
});

function cancelMapGesture() {
  if (!gesture) return false;
  const wasDragging = gesture.type === 'drag' && gesture.started;
  if (gesture.type === 'drag') gesture.marker.style.translate = '';
  gesture = null;
  for (const pointerId of pointers.keys()) {
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  }
  pointers.clear();
  skipMapClickUntil = performance.now() + 250;
  return wasDragging;
}

function endPointer(event) {
  if (!gesture || !pointers.delete(event.pointerId)) return;
  if (gesture.type === 'pinch') {
    skipMapClickUntil = performance.now() + 250;
    if (!pointers.size) gesture = null;
    return;
  }
  const previous = gesture;
  gesture = null;
  if (!previous.started) return;
  skipMapClickUntil = performance.now() + 250;
  if (previous.type !== 'drag') return;
  const marker = previous.marker;
  marker.style.translate = '';
  if (event.type !== 'pointerup') return;
  const table = data.tables.find((candidate) => candidate.id === marker.dataset.tableId);
  const zone = data.zones.find((candidate) => candidate.id === marker.dataset.zoneId);
  const item = table || zone;
  if (!item) return;
  const end = localPoint(event);
  const point = {x:Math.round(item.x + (end.x - previous.start.x) / scale), y:Math.round(item.y + (end.y - previous.start.y) / scale)};
  const snapped = table ? snapTable(point.x,point.y) : point;
  if (!snapped) { notify('请把圆桌放到对齐的桌位上。'); return; }
  const {x,y} = snapped;
  const valid = table ? canPlaceTable(x, y, table.id) : canPlaceZone({...zone, x, y});
  if (!valid) {
    notify('这里放不下，请换个位置。');
    return;
  }
  Object.assign(item, {x, y});
  selection = {type:table ? 'table' : 'zone', id:item.id};
  save('位置已更新',table ? '移动圆桌' : '移动留空区');
}

window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);
canvas.addEventListener('click', (event) => {
  if (event.detail && performance.now() < skipMapClickUntil) {
    event.stopPropagation();
    return;
  }
  if (!placement || isReadOnly() || !event.detail) return;
  event.stopPropagation();
  const point = localPoint(event);
  placeAt(Math.round((point.x - offset.x) / scale), Math.round((point.y - offset.y) / scale));
}, {capture:true});

$('guestSearch').addEventListener('input', renderGuestList);
function openGuestList(nextFilter, searchNow = false) {
  filter = nextFilter;
  $('guestSearch').value = '';
  renderGuestList();
  const target = searchNow ? $('guestSearch') : document.querySelector('[data-filter="unseated"]');
  target.scrollIntoView({block:'center'});
  target.focus({preventScroll:true});
}

$('quickSearch').onclick = () => openGuestList('all',true);
document.querySelector('.filter').addEventListener('click', (event) => {
  const item = event.target.closest('[data-filter]');
  if (!item) return;
  filter = item.dataset.filter;
  renderGuestList();
});
$('addGuest').onclick = $('quickAddGuest').onclick = () => editGuest(null);
$('detailBackdrop').onclick = () => showDetail(false);
$('addTable').onclick = () => beginPlacement(placement?.type === 'newTable' ? null : {type:'newTable'});
$('addZone').onclick = () => editZone(null);
$('cancelSwap').onclick = () => { swapFrom = null; renderMapHint(); };
$('cancelPlacement').onclick = () => beginPlacement(null);
$('fitMap').onclick = fit;
$('mapGestureToggle').onclick = () => { mapGestures = !mapGestures; renderMapHint(); };
$('zoomIn').onclick = () => zoomAt(scale * 1.23, {x:canvas.clientWidth / 2, y:canvas.clientHeight / 2});
$('zoomOut').onclick = () => zoomAt(scale / 1.23, {x:canvas.clientWidth / 2, y:canvas.clientHeight / 2});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !dialog.open) { swapFrom = null; beginPlacement(null); showDetail(false); }
});
window.addEventListener('hashchange', () => {
  const token = window.WeddingCloud.readToken(location.hash);
  if (token !== cloudToken) { location.reload(); return; }
  if (inCloud) return;
  placement = null;
  swapFrom = null;
  showDetail(false);
  if (currentZone() && isReadOnly()) selection = null;
  if (dialog.open) dialog.close();
  render();
});
window.addEventListener('storage', (event) => {
  if (inCloud && cloudRole !== 'edit') return;
  if (event.key === importBackupKey) {
    $('restoreImport').hidden = isReadOnly() || !readImportBackup();
    return;
  }
  if (event.key !== storageKey || !event.newValue) return;
  const cancelledDrag = cancelMapGesture();
  useSavedState(JSON.parse(event.newValue),event.newValue);
  if (dialog.open) {
    dialog.close();
    notify('另一个窗口已更新排座，请重新操作。');
  } else if (cancelledDrag) {
    notify('另一个窗口已更新排座，本次拖动已取消。');
  }
  render();
  fit();
});
function setDeskSummaryDefault() {
  $('deskSummaryDetails').open = !touchLayout.matches;
}

setDeskSummaryDefault();
touchLayout.addEventListener('change', () => { setDeskSummaryDefault(); mapGestures = false; showDetail(false); renderMapHint(); });

async function readXlsx(file) {
  const bytes = await file.arrayBuffer();
  const view = new DataView(bytes);
  const decoder = new TextDecoder();
  let trailer = bytes.byteLength - 22;
  const earliest = Math.max(0, trailer - 65535);
  while (trailer >= earliest && view.getUint32(trailer,true) !== 0x06054b50) trailer--;
  if (trailer < earliest || trailer < 0) throw new Error('请选择有效的 .xlsx 文件。');

  const count = view.getUint16(trailer + 10,true);
  let offset = view.getUint32(trailer + 16,true);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset,true) !== 0x02014b50) throw new Error('无法读取 Excel 文件结构。');
    const nameLength = view.getUint16(offset + 28,true);
    const name = decoder.decode(new Uint8Array(bytes,offset + 46,nameLength));
    entries.set(name,{
      method:view.getUint16(offset + 10,true), size:view.getUint32(offset + 20,true),
      expanded:view.getUint32(offset + 24,true), local:view.getUint32(offset + 42,true)
    });
    offset += 46 + nameLength + view.getUint16(offset + 30,true) + view.getUint16(offset + 32,true);
  }

  async function xml(name, optional = false) {
    const entry = entries.get(name);
    if (!entry && optional) return null;
    if (!entry || entry.expanded > 8 * 1024 * 1024) throw new Error('无法读取 Excel 工作表。');
    const start = entry.local + 30 + view.getUint16(entry.local + 26,true) + view.getUint16(entry.local + 28,true);
    const compressed = new Uint8Array(bytes,start,entry.size);
    let content = compressed;
    if (entry.method === 8) {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      content = new Uint8Array(await new Response(stream).arrayBuffer());
    } else if (entry.method !== 0) {
      throw new Error('Excel 的压缩格式无法读取。请用 Excel 重新另存为 .xlsx。');
    }
    const doc = new DOMParser().parseFromString(decoder.decode(content),'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Excel 工作表内容无法读取。');
    return doc;
  }

  const tags = (node, tag) => [...node.getElementsByTagNameNS('*', tag)];
  const [book, relations, strings] = await Promise.all([
    xml('xl/workbook.xml'),xml('xl/_rels/workbook.xml.rels'),xml('xl/sharedStrings.xml',true)
  ]);
  const sheet = tags(book,'sheet').find((item) => item.getAttribute('name') === 'Sheet1');
  const link = sheet && tags(relations,'Relationship').find((item) => item.getAttribute('Id') === sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'));
  if (!link) throw new Error('找不到这份宴请名单使用的 Sheet1。');
  const path = link.getAttribute('Target');
  const tab = await xml(path.startsWith('/') ? path.slice(1) : 'xl/' + path);
  const shared = strings ? tags(strings,'si').map((entry) => tags(entry,'t').map((item) => item.textContent).join('')) : [];
  const cells = new Map(tags(tab,'c').map((cell) => {
    const type = cell.getAttribute('t');
    const raw = tags(cell,'v')[0]?.textContent ?? '';
    const value = type === 's' ? shared[Number(raw)] : type === 'inlineStr' ? tags(cell,'t').map((item) => item.textContent).join('') : raw;
    return [cell.getAttribute('r'),String(value ?? '').trim()];
  }));
  return {cells, lastRow:Math.max(...tags(tab,'row').map((row) => Number(row.getAttribute('r'))))};
}

async function partiesFromWorkbook(file) {
  const {cells} = await readXlsx(file);
  // These are the same source ranges used by the seven subtotals in this roster.
  const groups = [['B','D',53],['H','J',53],['N','P',53],['T','V',53],['Z','AB',53],['AF','AG',52],['AK','AL',51]];
  if (groups.some(([,countColumn]) => cells.get(countColumn + '2') !== '人数')) {
    throw new Error('Excel 的分组列和原名单格式不同，请选择原格式的宴请名单。');
  }

  const parties = [];
  const issues = [];
  for (const [nameColumn,countColumn,lastRow] of groups) {
    const group = cells.get(nameColumn + '2') || '';
    for (let row = 3; row <= lastRow; row++) {
      const name = cells.get(nameColumn + row) || '';
      const enteredCount = cells.get(countColumn + row) || '';
      if ((!name && !enteredCount) || /^(小计|合计|总计)$/.test(name)) continue;
      const count = Number(enteredCount);
      const issue = nameColumn + row + ' / ' + countColumn + row;
      if (!Number.isInteger(count) || count < 1 || count > 2000) {
        issues.push(issue);
        continue;
      }
      if (!name) issues.push(issue);
      parties.push({id:nameColumn + row, name:name || '待补称呼', group, count, needsName:!name});
    }
  }
  if (!parties.length) throw new Error('没有找到填写了有效人数的记录。');
  return {parties,issues};
}

function waitingGuests(parties) {
  return parties.flatMap((party) => Array.from({length:party.count}, (_,index) => ({
    id:party.id + '-' + (index + 1), name:party.name, group:party.group, partyId:party.id,
    partySize:party.count, ordinal:index + 1, needsName:party.needsName, tableId:null, seat:null
  })));
}

function readImportBackup() {
  try {
    const backup = JSON.parse(localStorage.getItem(importBackupKey));
    return backup?.data?.guests && backup.data.tables && backup.data.zones ? backup : null;
  } catch {
    return null;
  }
}

function storeImportedState(next,label,keepBackup = false) {
  const error = commitChange(next,label,keepBackup);
  if (error) { render(); return error; }
  filter = 'all';
  $('guestSearch').value = '';
  if (!currentTable() && !currentZone()) selection = null;
  render();
  fit();
  return '';
}

function restoreImportBackup() {
  if (isReadOnly()) return;
  const backup = readImportBackup();
  if (!backup) { render(); return; }
  const date = new Date(backup.createdAt).toLocaleString('zh-CN');
  const count = backup.data.guests.length;
  const seated = backup.data.guests.filter((guest) => guest.tableId).length;
  const summary = element('p','',date + ' 的备份有 ' + count + ' 人，已排 ' + seated + ' 人。');
  const warning = element('p','import-warning','恢复会把名单、座位和桌位图还原到这次导入前，之后的改动会被替换。');
  openDialog('恢复导入前的排座',[summary,warning],'确认恢复',() => {
    const error = storeImportedState(backup.data,'恢复备份');
    if (!error) notify('已恢复导入前的排座');
    return error;
  });
}

async function importWorkbook(file) {
  const importButton = $('importGuests');
  importButton.disabled = true;
  try {
    const {parties,issues} = await partiesFromWorkbook(file);
    if (isReadOnly()) return;
    const guests = waitingGuests(parties);
    const missing = guests.filter((guest) => guest.needsName).length;
    const before = JSON.stringify(data);
    const seated = data.guests.filter((guest) => guest.tableId).length;
    const summary = element('p','','将导入 ' + guests.length + ' 人，共 ' + parties.length + ' 条名单。');
    const fields = [summary];
    if (missing) fields.push(element('p','','其中 ' + missing + ' 人待补称呼。'));
    if (issues.length) fields.push(element('p','','Excel 待核对单元格：' + issues.join('、')));
    if (data.guests.length) {
      fields.push(element('p','import-warning','当前名单有 ' + data.guests.length + ' 人，已排 ' + seated + ' 人。确认后会替换名单、清空座位安排，并在本机保留一份导入前的备份。'));
    }
    openDialog('预览导入名单',fields,'确认导入',() => {
      if (JSON.stringify(data) !== before) return '当前名单在另一个窗口有变化，请关闭后重新导入。';
      const error = storeImportedState({...data,guests,imported:true,importIssues:issues},'导入名单',data.guests.length > 0);
      if (!error) notify('已导入 ' + guests.length + ' 人');
      return error;
    });
  } catch (error) {
    notify(error instanceof RangeError ? 'Excel 文件结构无法读取。' : error.message);
  } finally {
    importButton.disabled = false;
  }
}

$('restoreImport').onclick = restoreImportBackup;
$('importGuests').onclick = () => $('guestWorkbook').click();
$('guestWorkbook').addEventListener('change', (event) => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file && !isReadOnly()) importWorkbook(file);
});

function renderCloudStatus() {
  if (!inCloud) return;
  const status = $('cloudStatus');
  status.hidden = false;
  $('cloudStatusText').textContent = cloudMessage || (savedState.pending ? '已保存在当前设备 · 点「保存排座」同步' : '已同步到独立后台');
  $('cloudReload').hidden = cloudRole !== 'edit' || !cloudConflict;
  $('cloudReload').disabled = cloudBusy;
  $('savePlan').disabled = cloudBusy || cloudConflict;
  $('undoLatest').disabled = cloudBusy || !savedState.undo;
}

function updateCloudMessage(message = '', conflict = false) {
  cloudMessage = message;
  cloudConflict = conflict;
  renderCloudStatus();
}

function ensureCloudResponse(remote) {
  if (!['edit','view'].includes(remote?.role)
      || !Number.isSafeInteger(remote.revision)
      || !Array.isArray(remote.data?.tables)
      || !Array.isArray(remote.data?.guests)
      || !Array.isArray(remote.data?.zones)
      || !Array.isArray(remote.data?.importIssues)) {
    throw new Error('wedding_unavailable');
  }
}

function setCloudSnapshot(remote) {
  const next = {data:remote.data,undo:null,serverRevision:remote.revision,pending:false};
  if (cloudRole === 'edit') {
    const error = persistRecord(next);
    if (error) {
      updateCloudMessage(error);
      return false;
    }
  } else {
    useSavedState(next,null);
  }
  if (!currentTable() && !currentZone()) {
    selection = data.tables.length ? {type:'table',id:data.tables[0].id} : null;
  }
  render();
  if (!$('workArea').hidden) fit();
  return true;
}

function cloudError(error) {
  if (error.message === 'wedding_forbidden') {
    cloudRole = null;
    $('workArea').hidden = true;
    renderEditorActions();
    updateCloudMessage('这个分享链接无效或已关闭。');
  } else if (error.message === 'wedding_conflict') {
    updateCloudMessage('另一台设备已保存最新版。本机改动还在，请核对后再载入云端。',true);
  } else if (error.message === 'wedding_invalid_plan') {
    updateCloudMessage('座位数据需要核对，当前改动保留在本机。');
  } else {
    updateCloudMessage(savedState.pending
      ? '网络或后台暂时不可用，本机改动已保留。稍后可重试保存。'
      : '暂时无法连接后台，请检查网络后刷新。');
  }
}

async function refreshCloud() {
  if (!cloudRole || cloudBusy || document.hidden) return;
  try {
    const remote = await window.WeddingCloud.load(cloudToken);
    ensureCloudResponse(remote);
    if (cloudBusy || !cloudRole || remote.revision < savedState.serverRevision) return;
    if (remote.role !== cloudRole) throw new Error('wedding_forbidden');
    if (remote.revision !== savedState.serverRevision) {
      if (cloudRole === 'edit' && savedState.pending) {
        updateCloudMessage('另一台设备已保存最新版。本机改动还在，请核对后再载入云端。',true);
      } else if (setCloudSnapshot(remote)) {
        updateCloudMessage();
      }
    } else if (!cloudConflict) {
      updateCloudMessage();
    }
  } catch (error) {
    cloudError(error);
  }
}

async function initializeCloud() {
  $('viewModes').hidden = true;
  $('workArea').hidden = true;
  updateCloudMessage('正在连接婚礼排座后台…');
  if (!/^[0-9a-f]{64}$/.test(cloudToken)) {
    cloudError(new Error('wedding_forbidden'));
    return;
  }
  try {
    const remote = await window.WeddingCloud.load(cloudToken);
    ensureCloudResponse(remote);
    cloudRole = remote.role;
    if (cloudRole === 'edit') {
      let raw;
      try { raw = localStorage.getItem(storageKey); } catch {}
      storedRevision = raw || null;
      let local;
      try { local = JSON.parse(raw); } catch {}
      if (local?.data && (local.serverRevision === remote.revision || local.pending)) {
        useSavedState(local,storedRevision);
      } else if (!setCloudSnapshot(remote)) {
        useSavedState({data:remote.data,undo:null,serverRevision:remote.revision,pending:false},storedRevision);
      }
    } else {
      setCloudSnapshot(remote);
    }
    $('workArea').hidden = false;
    render();
    fit();
    if (savedState.pending && savedState.serverRevision !== remote.revision) {
      updateCloudMessage('另一台设备已保存最新版。本机改动还在，请核对后再载入云端。',true);
    } else {
      updateCloudMessage();
    }
    setInterval(refreshCloud,8000);
    window.addEventListener('focus',refreshCloud);
  } catch (error) {
    cloudError(error);
  }
}

async function syncCloud() {
  if (cloudRole !== 'edit' || cloudBusy || cloudConflict) return;
  if (!savedState.pending) {
    await refreshCloud();
    if (!cloudMessage) notify('已同步');
    return;
  }
  cloudBusy = true;
  $('workArea').inert = true;
  updateCloudMessage('正在保存到后台…');
  const snapshot = savedState;
  try {
    const result = await window.WeddingCloud.save(cloudToken,snapshot.serverRevision,snapshot.data);
    if (!Number.isSafeInteger(result?.revision)) throw new Error('wedding_unavailable');
    const raw = localStorage.getItem(storageKey);
    if (raw && raw !== storedRevision) useSavedState(JSON.parse(raw),raw);
    const pending = JSON.stringify(savedState.data) !== JSON.stringify(snapshot.data);
    const error = persistRecord({...savedState,serverRevision:result.revision,pending});
    if (error) {
      updateCloudMessage('云端已保存，当前设备仍需刷新同步状态。',true);
    } else {
      updateCloudMessage();
      if (!pending) notify('已同步');
    }
  } catch (error) {
    cloudError(error);
  } finally {
    cloudBusy = false;
    $('workArea').inert = false;
    render();
  }
}

$('cloudReload').onclick = () => {
  if (cloudRole !== 'edit' || cloudBusy) return;
  confirmDialog('载入云端最新版','这会放弃本机尚未同步的改动，换成另一台设备保存的版本。','确认载入',async () => {
    cloudBusy = true;
    renderCloudStatus();
    try {
      const remote = await window.WeddingCloud.load(cloudToken);
      ensureCloudResponse(remote);
      if (setCloudSnapshot(remote)) updateCloudMessage();
    } catch (error) {
      cloudError(error);
    } finally {
      cloudBusy = false;
      render();
    }
  });
};


new ResizeObserver(() => { if (!$('workArea').hidden) fit(); }).observe(canvas);
if (inCloud) initializeCloud();
else { render(); fit(); }
