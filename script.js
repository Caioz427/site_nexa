/* NEXA EXECUTIVE PANEL — gestão dinâmica de lotes, catálogo, stock e vendas */
const STORAGE_KEY = "nexa_executive_data_v2";
const LEGACY_SALES_KEY = "nexa_executive_sales_v1";
let state = { exchangeRate: 1360, lots: [], products: [], sales: [] };
let lotChart = null;
let profitChart = null;
let toastTimer = null;

const $ = id => document.getElementById(id);
const money = value => `${Math.round(Number(value) || 0).toLocaleString("pt-PT")} Kz`;
const euro = value => `€${((Number(value)||0)/state.exchangeRate).toLocaleString("pt-PT",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const moneyHtml = value => `${money(value)}<small class="money-eur">${euro(value)}</small>`;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));

function toast(message) {
  const node = $("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 3200);
}
function showError(message, target = "formError") {
  const node = $(target); node.textContent = message; node.classList.add("visible");
}
function clearError(target = "formError") {
  const node = $(target); node.textContent = ""; node.classList.remove("visible");
}
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; }
  catch (error) { console.error(error); toast("Não foi possível guardar. Verifica o espaço do navegador."); return false; }
}
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { exchangeRate: Number(parsed.exchangeRate)>0?Number(parsed.exchangeRate):1360, lots: Array.isArray(parsed.lots) ? parsed.lots : [], products: Array.isArray(parsed.products) ? parsed.products.map(p=>({...p,category:p.category||"Perfumes"})) : [], sales: Array.isArray(parsed.sales) ? parsed.sales : [] };
    } else {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_SALES_KEY) || "[]");
      state.sales = Array.isArray(legacy) ? legacy.map(s => ({...s, productId:null, quantity:1})) : []; state.exchangeRate=1360;
      persist();
    }
  } catch (error) { console.error("Erro ao carregar dados:", error); state = {lots:[],products:[],sales:[]}; toast("Erro ao ler dados guardados."); }
}
function exportBackup() {
  const backup = {
    app: "NEXA Executive Panel",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    data: state
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = today();
  link.href = url;
  link.download = `NEXA-backup-${date}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast(`Backup exportado: ${state.lots.length} lotes, ${state.products.length} perfumes e ${state.sales.length} vendas.`);
}

function isValidBackupData(data) {
  if (!data || typeof data !== "object") return false;
  if (!Array.isArray(data.lots) || !Array.isArray(data.products) || !Array.isArray(data.sales)) return false;
  const validLot = data.lots.every(l => l && typeof l.id === "string" && typeof l.name === "string");
  const validProduct = data.products.every(p => p && typeof p.id === "string" && typeof p.name === "string" && typeof p.lotId === "string");
  const validSale = data.sales.every(s => s && typeof s.id === "string");
  return validLot && validProduct && validSale;
}

async function importBackup(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const data = parsed?.data;
    if (parsed?.app !== "NEXA Executive Panel" || parsed?.formatVersion !== 1 || !isValidBackupData(data)) {
      toast("Ficheiro inválido ou não reconhecido como backup NEXA.");
      return;
    }
    const summary = `${data.lots.length} lotes, ${data.products.length} perfumes e ${data.sales.length} vendas`;
    if (!confirm(`Este backup contém ${summary}.

A importação vai substituir os dados atualmente guardados neste navegador. Recomendo exportar primeiro um backup dos dados atuais.

Queres continuar?`)) return;
    const previousState = state;
    state = {
      exchangeRate: Number(data.exchangeRate)>0?Number(data.exchangeRate):1360,
      lots: data.lots,
      products: data.products.map(p=>({...p,category:p.category||"Perfumes"})),
      sales: data.sales
    };
    if (!persist()) {
      state = previousState;
      toast("Não foi possível importar. Os dados anteriores foram mantidos.");
      return;
    }
    refresh();
    toast(`Backup importado com sucesso: ${summary}.`);
  } catch (error) {
    console.error("Erro ao importar backup:", error);
    toast("Não foi possível ler o backup. Confirma se o ficheiro JSON está correto.");
  }
}

function lotName(id) { return state.lots.find(l => l.id === id)?.name || "Lote removido"; }
function getStats() {
  const revenue = state.sales.reduce((sum,s) => sum + Number(s.price || 0), 0);
  const investment = state.sales.reduce((sum,s) => sum + Number(s.cost || 0), 0);
  const paid = state.sales.reduce((sum,s) => sum + Number(s.paid || 0), 0);
  const debt = state.sales.reduce((sum,s) => sum + Math.max(0, Number(s.price || 0)-Number(s.paid || 0)), 0);
  const profit = revenue - investment;
  return { revenue, investment, paid, debt, profit, reserve:investment, freeCash:paid-investment, reinvestment:Math.max(0,profit)*0.5, personal:Math.max(0,profit)*0.5 };
}
function getLotStats() {
  return state.lots.map(lot => {
    const products = state.products.filter(p => p.lotId === lot.id);
    const productIds = new Set(products.map(p => p.id));
    const sales = state.sales.filter(s => s.lotId === lot.id || (!s.lotId && lot.name.toLocaleLowerCase("pt") === `lote ${s.lot}`.toLocaleLowerCase("pt")) || (s.productId && productIds.has(s.productId)));
    return { label:lot.name, revenue:sales.reduce((a,s)=>a+Number(s.price||0),0), investment:sales.reduce((a,s)=>a+Number(s.cost||0),0) };
  });
}
function updateKPIs() {
  const s = getStats();
  $("realRevenue").innerHTML = moneyHtml(s.revenue);
  $("realProfit").innerHTML = moneyHtml(s.profit); $("realProfit").classList.toggle("negative-value",s.profit<0);
  $("realReinvestment").innerHTML = moneyHtml(s.reinvestment);
  $("realPersonal").innerHTML = moneyHtml(s.personal);
  const plannedRevenue = state.products.reduce((a,p)=>a+Number(p.price||0)*Number(p.initialQty||0),0);
  const plannedInvestment = state.products.reduce((a,p)=>a+Number(p.cost||0)*Number(p.initialQty||0),0);
  $("forecastRevenue").innerHTML = moneyHtml(plannedRevenue);
  $("forecastInvestment").innerHTML = moneyHtml(plannedInvestment);
  $("forecastProfit").innerHTML = moneyHtml(plannedRevenue-plannedInvestment);
  $("donutProfit").innerHTML = moneyHtml(s.profit);
  $("legendReinvestment").innerHTML = moneyHtml(s.reinvestment);
  $("legendPersonal").innerHTML = moneyHtml(s.personal);
  $("exchangeRate").value=state.exchangeRate; $("treasuryGross").innerHTML=moneyHtml(s.revenue); $("capitalReserve").innerHTML=moneyHtml(s.reserve);
  $("freeCash").innerHTML=moneyHtml(s.freeCash); $("freeCash").classList.toggle("negative-value",s.freeCash<0);
  $("treasuryProfit").innerHTML=moneyHtml(s.profit); $("treasuryProfit").classList.toggle("negative-value",s.profit<0);
  updateCharts();
}
function initializeCharts() {
  if (typeof Chart === "undefined") { toast("Chart.js não carregou. Verifica a ligação à internet."); return; }
  const lineCtx = $("lotChart").getContext("2d");
  const gradient = lineCtx.createLinearGradient(0,0,0,280); gradient.addColorStop(0,"rgba(59,130,246,.25)"); gradient.addColorStop(1,"rgba(59,130,246,0)");
  lotChart = new Chart(lineCtx,{type:"line",data:{labels:[],datasets:[
    {label:"Faturação",data:[],borderColor:"#60a5fa",backgroundColor:gradient,borderWidth:3,pointRadius:5,tension:.35,fill:true},
    {label:"Investimento inicial",data:[],borderColor:"#f59e0b",backgroundColor:"rgba(245,158,11,.08)",borderWidth:2,borderDash:[6,5],pointRadius:4,tension:.35,fill:false}
  ]},options:{responsive:true,maintainAspectRatio:false,interaction:{intersect:false,mode:"index"},plugins:{legend:{position:"bottom",labels:{color:"#94a3b8",usePointStyle:true}},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${money(c.raw)} (${euro(c.raw)})`}}},scales:{x:{grid:{display:false},ticks:{color:"#94a3b8"}},y:{beginAtZero:true,grid:{color:"rgba(148,163,184,.08)"},ticks:{color:"#64748b",callback:v=>`${(v/1000).toLocaleString("pt-PT")}k`}}}}});
  profitChart = new Chart($("profitChart"),{type:"doughnut",data:{labels:["Reinvestimento","Proventos Pessoais"],datasets:[{data:[0,0],backgroundColor:["#3b82f6","#34d399"],borderColor:"#111827",borderWidth:5,hoverOffset:8}]},options:{responsive:true,maintainAspectRatio:false,cutout:"76%",plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.label}: ${money(c.raw)} (${euro(c.raw)})`}}}}});
  updateCharts();
}
function updateCharts() {
  if (lotChart) { const rows=getLotStats(); lotChart.data.labels=rows.map(x=>x.label); lotChart.data.datasets[0].data=rows.map(x=>x.revenue); lotChart.data.datasets[1].data=rows.map(x=>x.investment); lotChart.update(); }
  if (profitChart) { const s=getStats(); profitChart.data.datasets[0].data=[Math.max(0,s.reinvestment),Math.max(0,s.personal)]; profitChart.update(); }
}
function renderLotOptions() {
  const options=state.lots.map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("");
  $("productLot").innerHTML='<option value="">Selecionar lote</option>'+options;
  $("saleLot").innerHTML='<option value="">Selecionar lote</option>'+options;
}
function renderProductOptions() {
  const available=state.products.filter(p=>p.stock>0);
  $("perfumeName").innerHTML='<option value="">Selecionar perfume</option>'+available.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} — ${esc(lotName(p.lotId))} (${p.stock} un.)</option>`).join("");
  if (!available.length) $("perfumeName").innerHTML='<option value="">Sem perfumes disponíveis</option>';
}
function renderCatalog() {
  renderLotOptions(); renderProductOptions();
  const lotsBody=$("lotsTableBody");
  if (!state.lots.length) lotsBody.innerHTML='<tr><td colspan="4" class="catalog-empty">Ainda não existem lotes. Cria o primeiro lote.</td></tr>';
  else lotsBody.innerHTML=state.lots.map(l=>{
    const products=state.products.filter(p=>p.lotId===l.id); const stock=products.reduce((a,p)=>a+p.stock,0);
    return `<tr><td class="customer-name">${esc(l.name)}</td><td>${products.length}</td><td>${stock}</td><td><button class="delete-button" data-delete-lot="${esc(l.id)}" title="Eliminar lote" ${products.length?'disabled':''}><i class="fa-solid fa-trash"></i></button></td></tr>`;
  }).join("");
  const body=$("catalogTableBody");
  if (!state.products.length) body.innerHTML='<tr><td colspan="8" class="catalog-empty">Ainda não existem perfumes no catálogo.</td></tr>';
  else body.innerHTML=state.products.map(p=>`<tr><td class="customer-name">${esc(p.name)}</td><td><span class="category-badge">${esc(p.category||"Perfumes")}</span></td><td>${esc(lotName(p.lotId))}</td><td>${moneyHtml(p.cost)}</td><td>${moneyHtml(p.price)}</td><td>${p.stock}</td><td><span class="status-badge ${p.stock>0?'status-paid':'status-pending'}">${p.stock>0?'Disponível':'Esgotado'}</span></td><td><button class="delete-button" data-delete-product="${esc(p.id)}" title="Eliminar perfume"><i class="fa-solid fa-trash"></i></button></td></tr>`).join("");
  $("catalogCounter").textContent=`${state.products.length} perfumes · ${state.lots.length} lotes`;
}
function renderSales(search="") {
  const q=search.trim().toLocaleLowerCase("pt");
  const rows=state.sales.filter(s=>[s.client,s.perfume,lotName(s.lotId)||`Lote ${s.lot}`,s.paymentMethod].join(" ").toLocaleLowerCase("pt").includes(q)).sort((a,b)=>(b.date||"").localeCompare(a.date||"")||(b.createdAt||"").localeCompare(a.createdAt||""));
  $("salesCounter").textContent=`${state.sales.length} ${state.sales.length===1?'venda registada':'vendas registadas'}`;
  $("salesTableBody").innerHTML=rows.map((s,i)=>{const debt=Math.max(0,s.price-s.paid);const margin=Number(s.price||0)-Number(s.cost||0);const loss=margin<0;const date=new Date(`${s.date}T12:00:00`).toLocaleDateString("pt-PT");return `<tr><td>${rows.length-i}</td><td>${date}</td><td class="customer-name">${esc(s.client)}</td><td>${esc(s.perfume)}</td><td><span class="lot-badge">${esc(lotName(s.lotId)||`Lote ${s.lot||'—'}`)}</span></td><td>${moneyHtml(s.price)}</td><td>${moneyHtml(s.paid)}</td><td class="${debt?'debt-value':''}">${moneyHtml(debt)}</td><td class="${loss?'negative-value':''}">${moneyHtml(margin)}</td><td><span class="status-badge ${loss?'status-pending':debt?'status-pending':'status-paid'}">${loss?'Prejuízo':debt?'Pendente':'Pago'}</span></td><td><button class="delete-button" data-delete-sale="${esc(s.id)}" title="Eliminar venda"><i class="fa-solid fa-trash"></i></button></td></tr>`;}).join("");
  $("emptyState").style.display=rows.length?"none":"block";
  if (!rows.length) { $("emptyState").querySelector("h4").textContent=state.sales.length&&q?"Nenhum resultado encontrado":"Nenhuma venda registada"; $("emptyState").querySelector("p").textContent=state.sales.length&&q?"Experimenta pesquisar outro cliente ou perfume.":"As tuas vendas aparecerão aqui."; }
}
function refresh() { renderCatalog(); updateKPIs(); renderSales($("searchSales").value); }
function openModal(id) { $(id).classList.add("active"); document.body.style.overflow="hidden"; }
function closeModal(id) { $(id).classList.remove("active"); document.body.style.overflow=""; }

function addLot() {
  clearError("lotError"); const name=$("newLotName").value.trim();
  if (!name) return showError("Escreve o nome do lote.","lotError");
  if (state.lots.some(l=>l.name.toLocaleLowerCase("pt")===name.toLocaleLowerCase("pt"))) return showError("Já existe um lote com esse nome.","lotError");
  const previous=state.lots; state.lots=[...state.lots,{id:uid(),name,createdAt:new Date().toISOString()}];
  if (!persist()) {state.lots=previous;return;}
  $("newLotName").value=""; refresh(); toast("Lote criado com sucesso.");
}
function addProduct(event) {
  event.preventDefault(); clearError("productError");
  const name=$("productName").value.trim(), rawCost=Number($("productCost").value), currency=$("productCostCurrency").value, cost=currency==="EUR"?rawCost*state.exchangeRate:rawCost, price=Number($("productPrice").value), qty=Number($("productQty").value), lotId=$("productLot").value, category=$("productCategory").value;
  if (!name||!lotId) return showError("Preenche o nome e seleciona um lote.","productError");
  if(!["Perfumes","Áudio/Colunas","Telemóveis","Laptops","Gaming/Peças PC"].includes(category)) return showError("Seleciona uma categoria válida.","productError");
  if (![cost,price,qty].every(Number.isFinite)||cost<0||price<1||!Number.isInteger(qty)||qty<1) return showError("Confirma os valores: custo ≥ 0, preço ≥ 1 e stock inicial ≥ 1.","productError");
  if (state.products.some(p=>p.name.toLocaleLowerCase("pt")===name.toLocaleLowerCase("pt")&&p.lotId===lotId)) return showError("Este perfume já está registado neste lote.","productError");
  const product={id:uid(),name,category,cost,price,initialQty:qty,stock:qty,lotId,createdAt:new Date().toISOString()};
  state.products.push(product);
  if (!persist()) {state.products.pop();return;}
  $("productForm").reset(); $("productQty").value="1"; refresh(); toast("Perfume adicionado ao catálogo e ao stock.");
}
function selectedProductChanged() {
  const p=state.products.find(x=>x.id===$("perfumeName").value);
  if (!p) { $("salePrice").value=""; $("saleCost").value=""; $("saleLot").value=""; $("stockHint").textContent=""; return; }
  $("salePrice").value=p.price; $("saleCost").value=p.cost; $("saleLot").value=p.lotId; $("stockHint").textContent=`Stock disponível: ${p.stock} unidade(s). Custo: ${money(p.cost)} (${euro(p.cost)}). Preço planeado: ${money(p.price)} (${euro(p.price)}).`;
}
function registerSale(event) {
  event.preventDefault(); clearError();
  const product=state.products.find(p=>p.id===$("perfumeName").value);
  const client=$("clientName").value.trim(), date=$("saleDate").value, price=Number($("salePrice").value), cost=Number($("saleCost").value), paid=Number($("salePaid").value), method=$("paymentMethod").value;
  if (!client||!product||!date||!method) return showError("Preenche todos os campos obrigatórios.");
  if (date>today()||Number.isNaN(new Date(`${date}T12:00:00`).getTime())) return showError("Introduz uma data válida, não futura.");
  if (product.stock<1) return showError("Este perfume está esgotado. Atualiza o stock antes de vender.");
  if (![price,cost,paid].every(Number.isFinite)||price<1||cost<0||paid<0||paid>price) return showError("Confirma os valores. O pagamento não pode exceder o preço total.");
  const oldStock=product.stock; product.stock--;
  const sale={id:uid(),client,productId:product.id,perfume:product.name,lotId:product.lotId,price,cost,paid,date,paymentMethod:method,quantity:1,createdAt:new Date().toISOString()};
  state.sales.push(sale);
  if (!persist()) {state.sales.pop();product.stock=oldStock;return;}
  $("saleForm").reset(); $("saleDate").value=today(); $("salePaid").value="0"; $("stockHint").textContent=""; closeModal("saleModal"); refresh(); toast(product.stock===0?"Venda guardada. Produto agora esgotado.":"Venda registada e stock atualizado.");
}
function deleteSale(id) {
  const index=state.sales.findIndex(s=>s.id===id); if(index<0)return;
  const sale=state.sales[index]; if(!confirm(`Eliminar a venda de ${sale.client}? O stock será reposto.`))return;
  const product=state.products.find(p=>p.id===sale.productId); if(product) product.stock+=Number(sale.quantity||1);
  state.sales.splice(index,1);
  if(!persist()){state.sales.splice(index,0,sale);if(product)product.stock-=Number(sale.quantity||1);return;}
  refresh(); toast("Venda eliminada e stock reposto.");
}
function deleteProduct(id) {
  const product=state.products.find(p=>p.id===id); if(!product)return;
  if(state.sales.some(s=>s.productId===id)) return toast("Não podes eliminar um perfume com vendas associadas. Mantém o histórico.");
  if(!confirm(`Eliminar ${product.name} do catálogo?`))return;
  const old=state.products; state.products=state.products.filter(p=>p.id!==id); if(!persist()){state.products=old;return;} refresh(); toast("Perfume eliminado.");
}
function deleteLot(id) {
  const lot=state.lots.find(l=>l.id===id); if(!lot)return;
  if(state.products.some(p=>p.lotId===id))return toast("Remove primeiro os perfumes deste lote.");
  if(!confirm(`Eliminar ${lot.name}?`))return;
  const old=state.lots; state.lots=state.lots.filter(l=>l.id!==id); if(!persist()){state.lots=old;return;} refresh(); toast("Lote eliminado.");
}
function init() {
  const now=new Date(); $("currentDate").textContent=now.toLocaleDateString("pt-PT",{day:"2-digit",month:"long",year:"numeric"}); $("footerYear").textContent=now.getFullYear(); $("saleDate").value=today(); $("productQty").value="1";
  loadState(); initializeCharts(); refresh();
  $("openSaleModal").addEventListener("click",()=>{renderProductOptions();$("saleForm").reset();$("saleDate").value=today();$("salePaid").value="0";$("stockHint").textContent="";clearError();openModal("saleModal");});
  $("closeSaleModal").addEventListener("click",()=>closeModal("saleModal")); $("cancelSale").addEventListener("click",()=>closeModal("saleModal"));
  $("saleModal").addEventListener("click",e=>{if(e.target===$("saleModal"))closeModal("saleModal");});
  $("saleForm").addEventListener("submit",registerSale); $("perfumeName").addEventListener("change",selectedProductChanged); $("searchSales").addEventListener("input",e=>renderSales(e.target.value));
  $("addLotButton").addEventListener("click",addLot); $("productForm").addEventListener("submit",addProduct);
  $("catalogTableBody").addEventListener("click",e=>{const b=e.target.closest("[data-delete-product]");if(b)deleteProduct(b.dataset.deleteProduct);});
  $("lotsTableBody").addEventListener("click",e=>{const b=e.target.closest("[data-delete-lot]");if(b&&!b.disabled)deleteLot(b.dataset.deleteLot);});
  $("salesTableBody").addEventListener("click",e=>{const b=e.target.closest("[data-delete-sale]");if(b)deleteSale(b.dataset.deleteSale);});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"){document.querySelectorAll(".modal-overlay.active").forEach(m=>closeModal(m.id));}});
  $("sheetsButton").addEventListener("click",e=>{e.preventDefault();toast("A ligação ao Google Sheets ainda não está configurada.");});
  $("exchangeRate").value=state.exchangeRate;
  $("exchangeRate").addEventListener("change",()=>{const r=Number($("exchangeRate").value);if(!Number.isFinite(r)||r<=0){$("exchangeRate").value=state.exchangeRate;return toast("A taxa deve ser superior a zero.");}state.exchangeRate=r;persist();refresh();toast("Taxa de câmbio atualizada.");});
  $("exchangeRate").value=state.exchangeRate;
  $("exchangeRate").addEventListener("change",()=>{const r=Number($("exchangeRate").value);if(!Number.isFinite(r)||r<=0){$("exchangeRate").value=state.exchangeRate;return toast("A taxa deve ser superior a zero.");}state.exchangeRate=r;persist();refresh();toast("Taxa de câmbio atualizada.");});
  $("exportBackupButton").addEventListener("click", exportBackup);
  $("importBackupButton").addEventListener("click", () => $("backupFileInput").click());
  $("backupFileInput").addEventListener("change", e => {
    const file = e.target.files?.[0];
    if (file) importBackup(file);
    e.target.value = "";
  });
  console.log("NEXA Executive Panel iniciado.");
}
document.addEventListener("DOMContentLoaded",init);
