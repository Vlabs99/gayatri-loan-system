import { auth, db } from "./firebase-config.js";
import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

// State
let customerAccounts = [];
let adminAccounts = [];
let currentTab = "customers"; // "customers" | "admins"
let currentSearch = "";

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function renderTable() {
    const tableBody = document.getElementById("userTableBody");
    const detailsColHeader = document.getElementById("detailsColHeader");
    if (!tableBody) return;

    if (detailsColHeader) {
        detailsColHeader.innerText = currentTab === "customers" ? "Customer Details" : "Admin Details";
    }

    const sourceList = currentTab === "customers" ? customerAccounts : adminAccounts;
    const query = currentSearch.trim().toLowerCase();

    const filtered = query
        ? sourceList.filter(acc => {
            const name = (acc.name || "").toLowerCase();
            const email = (acc.email || "").toLowerCase();
            const phone = (acc.phone || "").toLowerCase();
            const address = (acc.address || "").toLowerCase();
            const id = (acc.id || "").toLowerCase();
            return name.includes(query) || email.includes(query) || phone.includes(query) || address.includes(query) || id.includes(query);
        })
        : sourceList;

    if (filtered.length === 0) {
        let emptyMsg = "";
        if (query) {
            emptyMsg = `No ${currentTab} match your search "${escapeHtml(currentSearch)}".`;
        } else if (currentTab === "customers") {
            emptyMsg = "No registered customers found.";
        } else {
            emptyMsg = "No admin accounts found.";
        }
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 40px; color: var(--secondary);">${emptyMsg}</td></tr>`;
        return;
    }

    let html = "";
    filtered.forEach((acc) => {
        const isCustomer = acc.role === "customer";
        const badgeClass = isCustomer ? "badge-customer" : "badge-admin";
        const badgeText = isCustomer ? "Customer" : "Admin";
        const uidShort = acc.id ? acc.id.slice(0, 8) : "";

        html += `
            <tr>
                <td>
                    <div class="user-name-row">
                        <span class="user-name">${escapeHtml(acc.name || (isCustomer ? "Unnamed Customer" : "Admin"))}</span>
                        <span class="badge-role ${badgeClass}">${badgeText}</span>
                    </div>
                    <span class="user-email">${escapeHtml(acc.email || "No email")} &bull; UID: ${escapeHtml(uidShort)}...</span>
                </td>
                <td>${escapeHtml(acc.phone || "N/A")}</td>
                <td>${escapeHtml(acc.address || "N/A")}</td>
                <td>
                    <button class="btn-view" onclick="location.href='admin.html'">Manage</button>
                </td>
            </tr>
        `;
    });

    tableBody.innerHTML = html;
}

window.switchTab = function(tab) {
    if (tab !== "customers" && tab !== "admins") return;
    currentTab = tab;

    const customersBtn = document.getElementById("tabCustomersBtn");
    const adminsBtn = document.getElementById("tabAdminsBtn");

    if (customersBtn) {
        customersBtn.classList.toggle("active", tab === "customers");
        customersBtn.setAttribute("aria-selected", tab === "customers" ? "true" : "false");
    }
    if (adminsBtn) {
        adminsBtn.classList.toggle("active", tab === "admins");
        adminsBtn.setAttribute("aria-selected", tab === "admins" ? "true" : "false");
    }

    renderTable();
};

window.handleSearch = function() {
    const input = document.getElementById("searchInput");
    currentSearch = input ? input.value : "";
    renderTable();
};

async function loadAccounts() {
    const tableBody = document.getElementById("userTableBody");
    if (!tableBody) return;

    try {
        // Query both admins and users collections in parallel
        const [adminsSnapRes, usersSnapRes] = await Promise.allSettled([
            getDocs(collection(db, "admins")),
            getDocs(collection(db, "users"))
        ]);

        const adminDocs = adminsSnapRes.status === "fulfilled" ? adminsSnapRes.value.docs : [];
        const userDocs = usersSnapRes.status === "fulfilled" ? usersSnapRes.value.docs : [];

        // Build Admin UIDs set and store any doc data from 'admins'
        const adminMap = new Map();
        adminDocs.forEach((docSnap) => {
            const uid = docSnap.id;
            const data = docSnap.data() || {};
            adminMap.set(uid, { id: uid, ...data });
        });

        // Map users by UID and check for role === "admin"
        const userMap = new Map();
        userDocs.forEach((docSnap) => {
            const uid = docSnap.id;
            const data = docSnap.data() || {};
            userMap.set(uid, { id: uid, ...data });

            const role = (data.role || "").toString().toLowerCase().trim();
            const isAdminFlag = data.isAdmin === true || role === "admin";
            if (isAdminFlag) {
                if (!adminMap.has(uid)) {
                    adminMap.set(uid, { id: uid, ...data });
                }
            }
        });

        // Assemble Admins list
        adminAccounts = [];
        adminMap.forEach((adminData, uid) => {
            const userData = userMap.get(uid) || {};
            const merged = {
                id: uid,
                name: userData.name || userData.fullName || adminData.name || adminData.fullName || (adminData.email ? adminData.email.split("@")[0] : "") || "Admin User",
                email: userData.email || adminData.email || "",
                phone: userData.phone || userData.phoneNumber || adminData.phone || adminData.phoneNumber || "N/A",
                address: userData.address || adminData.address || "N/A",
                role: "admin",
                rawUser: userData,
                rawAdmin: adminData
            };
            adminAccounts.push(merged);
        });

        // Assemble Customers list (users that are NOT admins)
        customerAccounts = [];
        userDocs.forEach((docSnap) => {
            const uid = docSnap.id;
            const data = docSnap.data() || {};
            const role = (data.role || "").toString().toLowerCase().trim();
            const isAdminFlag = data.isAdmin === true || role === "admin";

            // If UID is in adminMap or has admin role, it is an Admin, NOT a Customer
            if (adminMap.has(uid) || isAdminFlag) {
                return;
            }

            customerAccounts.push({
                id: uid,
                name: data.name || data.fullName || "Unnamed Customer",
                email: data.email || "",
                phone: data.phone || data.phoneNumber || "N/A",
                address: data.address || "N/A",
                role: "customer",
                rawUser: data
            });
        });

        // Update counts
        const customerCountEl = document.getElementById("customerCount");
        const adminCountEl = document.getElementById("adminCount");
        if (customerCountEl) customerCountEl.innerText = customerAccounts.length;
        if (adminCountEl) adminCountEl.innerText = adminAccounts.length;

        // Render table
        renderTable();

    } catch (err) {
        console.error("Error loading accounts:", err);
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: red; padding: 20px;">Error loading accounts: ${escapeHtml(err.message)}</td></tr>`;
    }
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        loadAccounts();
    } else {
        window.location.href = "admin-login.html";
    }
});