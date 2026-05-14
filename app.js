// app.js - PazarYo Ana Uygulama

// App State
let appData = {
    products: [],
    suppliers: [],
    expenses: [],
    incomes: [],
    settings: { darkMode: false }
};

let currentPage = 'dashboard';
let charts = {};

// Load data from localStorage
function loadData() {
    const saved = localStorage.getItem('pazaryo_data');
    if (saved) {
        appData = JSON.parse(saved);
    } else {
        // Initialize demo data
        appData.products = [
            { id: 1, name: 'Domates', category: 'Sebze', costPrice: 5, salePrice: 8, stock: 100, unit: 'Kilogram', image: '' },
            { id: 2, name: 'Elma', category: 'Meyve', costPrice: 6, salePrice: 10, stock: 80, unit: 'Kilogram', image: '' }
        ];
        appData.suppliers = [];
        appData.expenses = [];
        appData.incomes = [];
    }
    applyDarkMode();
}

// Save data to localStorage
function saveData() {
    localStorage.setItem('pazaryo_data', JSON.stringify(appData));
    checkLowStock();
}

// Show notification
function showNotification(message, type = 'info') {
    const notif = document.createElement('div');
    notif.className = 'notification';
    notif.style.background = type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3';
    notif.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : 'info-circle'}"></i> ${message}`;
    document.body.appendChild(notif);
    setTimeout(() => notif.remove(), 3000);
}

// Check low stock
function checkLowStock() {
    const lowStockProducts = appData.products.filter(p => p.stock < 20);
    if (lowStockProducts.length > 0) {
        showNotification(`${lowStockProducts.length} ürün stokta kritik seviyede!`, 'error');
    }
}

// Render functions
function renderDashboard() {
    const totalIncome = appData.incomes.reduce((sum, inc) => sum + inc.amount, 0);
    const totalExpense = appData.expenses.reduce((sum, exp) => sum + exp.amount, 0);
    const profit = totalIncome - totalExpense;
    
    // Get today's date
    const today = new Date().toDateString();
    const todayIncome = appData.incomes.filter(i => new Date(i.date).toDateString() === today).reduce((s, i) => s + i.amount, 0);
    const todayExpense = appData.expenses.filter(e => new Date(e.date).toDateString() === today).reduce((s, e) => s + e.amount, 0);
    
    // Best selling product
    const productSales = {};
    appData.incomes.forEach(inc => {
        if (inc.productSales) {
            inc.productSales.forEach(sale => {
                productSales[sale.name] = (productSales[sale.name] || 0) + sale.quantity;
            });
        }
    });
    const bestProduct = Object.entries(productSales).sort((a,b) => b[1] - a[1])[0];
    
    const html = `
        <div class="stats-grid">
            <div class="stat-card"><i class="fas fa-chart-line"></i><div class="stat-value">₺${profit.toFixed(2)}</div><div class="stat-label">Toplam Kar/Zarar</div></div>
            <div class="stat-card"><i class="fas fa-coins"></i><div class="stat-value">₺${totalIncome.toFixed(2)}</div><div class="stat-label">Toplam Gelir</div></div>
            <div class="stat-card"><i class="fas fa-money-bill-wave"></i><div class="stat-value">₺${totalExpense.toFixed(2)}</div><div class="stat-label">Toplam Gider</div></div>
            <div class="stat-card"><i class="fas fa-calendar-day"></i><div class="stat-value">₺${(todayIncome - todayExpense).toFixed(2)}</div><div class="stat-label">Günlük Kar/Zarar</div></div>
        </div>
        
        <div class="card">
            <div class="card-header"><h3>Günlük Satış Grafiği</h3></div>
            <canvas id="dailyChart"></canvas>
        </div>
        
        <div class="card">
            <div class="card-header"><h3>En Çok Satılan Ürün</h3></div>
            <p><strong>${bestProduct ? bestProduct[0] : 'Henüz veri yok'}</strong> - ${bestProduct ? bestProduct[1] : 0} adet</p>
        </div>
        
        <div class="card">
            <div class="card-header"><h3>Düşük Stok Uyarıları</h3></div>
            <div id="lowStockList"></div>
        </div>
    `;
    
    document.getElementById('mainContent').innerHTML = html;
    
    // Create chart
    const last7Days = [...Array(7)].map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - i);
        return d.toDateString();
    }).reverse();
    
    const dailyData = last7Days.map(day => {
        return appData.incomes.filter(i => new Date(i.date).toDateString() === day).reduce((s, i) => s + i.amount, 0);
    });
    
    const ctx = document.getElementById('dailyChart').getContext('2d');
    if (charts.daily) charts.daily.destroy();
    charts.daily = new Chart(ctx, {
        type: 'line',
        data: { labels: last7Days.map(d => d.slice(0,10)), datasets: [{ label: 'Gelir (₺)', data: dailyData, borderColor: '#F57C00', tension: 0.4 }] }
    });
    
    const lowStockHtml = appData.products.filter(p => p.stock < 20).map(p => `<p>⚠️ ${p.name}: ${p.stock} ${p.unit} kaldı</p>`).join('');
    document.getElementById('lowStockList').innerHTML = lowStockHtml || '<p>Tüm stoklar yeterli ✅</p>';
}

function renderProducts() {
    const html = `
        <div class="card">
            <div class="card-header"><h3>Ürün Yönetimi</h3><button class="btn btn-primary" onclick="openProductModal()"><i class="fas fa-plus"></i> Ürün Ekle</button></div>
            <div class="search-bar"><input type="text" id="productSearch" placeholder="Ürün ara..." onkeyup="filterProducts()"></div>
            <div class="product-grid" id="productGrid"></div>
        </div>
    `;
    document.getElementById('mainContent').innerHTML = html;
    renderProductList();
}

function renderProductList() {
    const searchTerm = document.getElementById('productSearch')?.value.toLowerCase() || '';
    const filtered = appData.products.filter(p => p.name.toLowerCase().includes(searchTerm));
    const grid = document.getElementById('productGrid');
    if (!grid) return;
    
    grid.innerHTML = filtered.map(p => `
        <div class="product-card">
            ${p.image ? `<img src="${p.image}" alt="${p.name}">` : '<i class="fas fa-apple-alt" style="font-size: 60px; color: #F57C00;"></i>'}
            <h4>${p.name}</h4>
            <p>₺${p.salePrice} / ${p.unit}</p>
            <p>Stok: ${p.stock}</p>
            <div class="product-actions">
                <button class="icon-btn" onclick="editProduct(${p.id})"><i class="fas fa-edit"></i></button>
                <button class="icon-btn" onclick="deleteProduct(${p.id})"><i class="fas fa-trash"></i></button>
                <button class="icon-btn" onclick="updateStock(${p.id})"><i class="fas fa-boxes"></i></button>
            </div>
        </div>
    `).join('');
}

function openProductModal(product = null) {
    const isEdit = !!product;
    const modalHtml = `
        <div class="modal" id="productModal">
            <h3>${isEdit ? 'Ürün Düzenle' : 'Yeni Ürün'}</h3>
            <form id="productForm">
                <div class="form-group"><label>Ürün Adı</label><input type="text" id="prodName" value="${product?.name || ''}" required></div>
                <div class="form-group"><label>Kategori</label><input type="text" id="prodCategory" value="${product?.category || ''}"></div>
                <div class="form-group"><label>Maliyet (₺)</label><input type="number" id="prodCost" value="${product?.costPrice || ''}" step="0.01"></div>
                <div class="form-group"><label>Satış Fiyatı (₺)</label><input type="number" id="prodPrice" value="${product?.salePrice || ''}" step="0.01" required></div>
                <div class="form-group"><label>Stok</label><input type="number" id="prodStock" value="${product?.stock || 0}"></div>
                <div class="form-group"><label>Birim</label><select id="prodUnit"><option>Kilogram</option><option>Gram</option><option>Adet</option><option>Kasa</option><option>Litre</option></select></div>
                <div class="form-group"><label>Resim URL</label><input type="text" id="prodImage" value="${product?.image || ''}"></div>
                <button type="submit" class="btn btn-primary">Kaydet</button>
                <button type="button" class="btn" onclick="closeModal()">İptal</button>
            </form>
        </div>
    `;
    showModal(modalHtml);
    if (product) document.getElementById('prodUnit').value = product.unit;
    
    document.getElementById('productForm').onsubmit = (e) => {
        e.preventDefault();
        const newProduct = {
            id: product?.id || Date.now(),
            name: document.getElementById('prodName').value,
            category: document.getElementById('prodCategory').value,
            costPrice: parseFloat(document.getElementById('prodCost').value),
            salePrice: parseFloat(document.getElementById('prodPrice').value),
            stock: parseInt(document.getElementById('prodStock').value),
            unit: document.getElementById('prodUnit').value,
            image: document.getElementById('prodImage').value
        };
        if (isEdit) {
            const index = appData.products.findIndex(p => p.id === product.id);
            appData.products[index] = newProduct;
        } else {
            appData.products.push(newProduct);
        }
        saveData();
        closeModal();
        renderProducts();
        showNotification('Ürün kaydedildi', 'success');
    };
}

function editProduct(id) {
    const product = appData.products.find(p => p.id === id);
    if (product) openProductModal(product);
}

function deleteProduct(id) {
    if (confirm('Ürün silinsin mi?')) {
        appData.products = appData.products.filter(p => p.id !== id);
        saveData();
        renderProducts();
        showNotification('Ürün silindi', 'success');
    }
}

function updateStock(id) {
    const product = appData.products.find(p => p.id === id);
    const newStock = prompt('Yeni stok miktarı:', product.stock);
    if (newStock !== null) {
        product.stock = parseInt(newStock);
        saveData();
        renderProducts();
        showNotification('Stok güncellendi', 'success');
    }
}

function filterProducts() { renderProductList(); }

// Gider Yönetimi
function renderExpenses() {
    const html = `
        <div class="card">
            <div class="card-header"><h3>Gider Yönetimi</h3><button class="btn btn-primary" onclick="openExpenseModal()"><i class="fas fa-plus"></i> Gider Ekle</button></div>
            <div class="table-responsive"><table><thead><tr><th>Tarih</th><th>Açıklama</th><th>Tutar</th><th></th></tr></thead><tbody id="expenseList"></tbody></table></div>
        </div>
    `;
    document.getElementById('mainContent').innerHTML = html;
    renderExpenseList();
}

function renderExpenseList() {
    const tbody = document.getElementById('expenseList');
    if (!tbody) return;
    tbody.innerHTML = appData.expenses.map(e => `
        <tr><td>${new Date(e.date).toLocaleDateString()}</td><td>${e.description}</td><td>₺${e.amount}</td><td><button onclick="deleteExpense(${e.id})" class="icon-btn"><i class="fas fa-trash"></i></button></td></tr>
    `).join('');
}

function openExpenseModal(expense = null) {
    const modalHtml = `
        <div class="modal"><h3>Gider Ekle</h3><form id="expenseForm">
            <div class="form-group"><label>Açıklama</label><input type="text" id="expDesc" required></div>
            <div class="form-group"><label>Tutar (₺)</label><input type="number" id="expAmount" step="0.01" required></div>
            <div class="form-group"><label>Tarih</label><input type="date" id="expDate" value="${new Date().toISOString().split('T')[0]}" required></div>
            <button type="submit" class="btn btn-primary">Kaydet</button><button type="button" class="btn" onclick="closeModal()">İptal</button>
        </form></div>
    `;
    showModal(modalHtml);
    document.getElementById('expenseForm').onsubmit = (e) => {
        e.preventDefault();
        appData.expenses.push({
            id: Date.now(),
            description: document.getElementById('expDesc').value,
            amount: parseFloat(document.getElementById('expAmount').value),
            date: document.getElementById('expDate').value
        });
        saveData();
        closeModal();
        renderExpenses();
        showNotification('Gider eklendi', 'success');
    };
}

function deleteExpense(id) {
    appData.expenses = appData.expenses.filter(e => e.id !== id);
    saveData();
    renderExpenses();
}

// Gelir Yönetimi
function renderIncomes() {
    const html = `
        <div class="card">
            <div class="card-header"><h3>Gelir Yönetimi</h3><button class="btn btn-primary" onclick="openIncomeModal()"><i class="fas fa-plus"></i> Gelir Ekle</button></div>
            <div class="table-responsive"><table><thead><tr><th>Tarih</th><th>Açıklama</th><th>Tutar</th><th></th></tr></thead><tbody id="incomeList"></tbody></table></div>
        </div>
    `;
    document.getElementById('mainContent').innerHTML = html;
    renderIncomeList();
}

function renderIncomeList() {
    const tbody = document.getElementById('incomeList');
    if (!tbody) return;
    tbody.innerHTML = appData.incomes.map(i => `
        <tr><td>${new Date(i.date).toLocaleDateString()}</td><td>${i.description}</td><td>₺${i.amount}</td><td><button onclick="deleteIncome(${i.id})" class="icon-btn"><i class="fas fa-trash"></i></button></td></tr>
    `).join('');
}

function openIncomeModal() {
    const modalHtml = `
        <div class="modal"><h3>Gelir Ekle</h3><form id="incomeForm">
            <div class="form-group"><label>Açıklama</label><input type="text" id="incDesc" required></div>
            <div class="form-group"><label>Tutar (₺)</label><input type="number" id="incAmount" step="0.01" required></div>
            <div class="form-group"><label>Tarih</label><input type="date" id="incDate" value="${new Date().toISOString().split('T')[0]}" required></div>
            <button type="submit" class="btn btn-primary">Kaydet</button><button type="button" class="btn" onclick="closeModal()">İptal</button>
        </form></div>
    `;
    showModal(modalHtml);
    document.getElementById('incomeForm').onsubmit = (e) => {
        e.preventDefault();
        appData.incomes.push({
            id: Date.now(),
            description: document.getElementById('incDesc').value,
            amount: parseFloat(document.getElementById('incAmount').value),
            date: document.getElementById('incDate').value
        });
        saveData();
        closeModal();
        renderIncomes();
        showNotification('Gelir eklendi', 'success');
    };
}

function deleteIncome(id) {
    appData.incomes = appData.incomes.filter(i => i.id !== id);
    saveData();
    renderIncomes();
}

// Rapor dışa aktarma
function exportToExcel() {
    const wsData = [['Tip', 'Açıklama', 'Tutar', 'Tarih']];
    appData.incomes.forEach(i => wsData.push(['Gelir', i.description, i.amount, i.date]));
    appData.expenses.forEach(e => wsData.push(['Gider', e.description, e.amount, e.date]));
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Rapor');
    XLSX.writeFile(wb, `PazarYo_Rapor_${new Date().toISOString().split('T')[0]}.xlsx`);
    showNotification('Excel raporu oluşturuldu', 'success');
}

// Helper functions
function showModal(content) {
    const container = document.getElementById('modalContainer');
    container.innerHTML = content;
    container.style.display = 'flex';
}

function closeModal() {
    document.getElementById('modalContainer').style.display = 'none';
}

function applyDarkMode() {
    if (appData.settings.darkMode) document.body.classList.add('dark');
    else document.body.classList.remove('dark');
}

function toggleDarkMode() {
    appData.settings.darkMode = !appData.settings.darkMode;
    saveData();
    applyDarkMode();
}

// Navigation
function navigateTo(page) {
    currentPage = page;
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });
    
    switch(page) {
        case 'dashboard': renderDashboard(); break;
        case 'products': renderProducts(); break;
        case 'expenses': renderExpenses(); break;
        case 'incomes': renderIncomes(); break;
        case 'reports': renderReports(); break;
        default: renderDashboard();
    }
}

function renderReports() {
    document.getElementById('mainContent').innerHTML = `
        <div class="card"><div class="card-header"><h3>Raporlar</h3></div>
        <button class="btn btn-primary" onclick="exportToExcel()"><i class="fas fa-file-excel"></i> Excel'e Aktar</button>
        <button class="btn btn-secondary" onclick="window.print()"><i class="fas fa-print"></i> Yazdır</button></div>
    `;
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    navigateTo('dashboard');
    document.getElementById('darkModeToggle').addEventListener('click', toggleDarkMode);
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => navigateTo(btn.dataset.page));
    });
});

window.filterProducts = filterProducts;
window.openProductModal = openProductModal;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.updateStock = updateStock;
window.openExpenseModal = openExpenseModal;
window.deleteExpense = deleteExpense;
window.openIncomeModal = openIncomeModal;
window.deleteIncome = deleteIncome;
window.exportToExcel = exportToExcel;
window.closeModal = closeModal;
