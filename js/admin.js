import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

import {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Cache for customer details (UID -> User Object) and loans
const cachedUsers = new Map();
let cachedLoans = [];

/* ================= HELPER: FORMAT CURRENCY ================= */
const formatCurrency = (amount) => {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(num);
};

/* ================= HELPER: ESCAPE HTML ================= */
function escapeHtml(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* ================= UI NOTIFICATIONS & BANNER ================= */
function showErrorBanner(message) {
  const banner = document.getElementById("adminErrorBanner");
  if (banner) {
    banner.style.display = "block";
    banner.innerHTML = `<strong>Firestore Notice:</strong> ${escapeHtml(message)}`;
  }
  console.error("Dashboard Error:", message);
}

function clearErrorBanner() {
  const banner = document.getElementById("adminErrorBanner");
  if (banner) {
    banner.style.display = "none";
    banner.innerHTML = "";
  }
}

/* ================= SET LOADING STATE ================= */
function setLoadingState() {
  const totalUsersEl = document.getElementById("totalUsers");
  const activeLoansEl = document.getElementById("totalActiveLoans");
  const outstandingEl = document.getElementById("totalOutstanding");
  const closedLoansEl = document.getElementById("totalClosedLoans");
  const createSelect = document.getElementById("userId");
  const historyTable = document.getElementById("loanHistoryTable");

  if (totalUsersEl) totalUsersEl.innerText = "...";
  if (activeLoansEl) activeLoansEl.innerText = "...";
  if (outstandingEl) outstandingEl.innerText = "...";
  if (closedLoansEl) closedLoansEl.innerText = "...";

  if (createSelect) {
    createSelect.innerHTML = `<option value="">Loading Users...</option>`;
  }
  if (historyTable) {
    historyTable.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:35px; color:var(--text-muted);">Loading records from Firestore...</td></tr>`;
  }
}

/* ================= LOAD REGISTERED CUSTOMERS ================= */
async function loadUsers() {
  const createSelect = document.getElementById("userId");
  const historySelect = document.getElementById("historyUserSelect");
  const totalUsersEl = document.getElementById("totalUsers");

  try {
    // Registered customers are stored in the 'users' Firestore collection
    const usersSnapshot = await getDocs(collection(db, "users"));
    cachedUsers.clear();

    if (!createSelect) return;

    if (usersSnapshot.empty) {
      createSelect.innerHTML = `<option value="">No registered customers found</option>`;
      if (historySelect) {
        historySelect.innerHTML = `<option value="">All Users (0 found)</option>`;
      }
      if (totalUsersEl) totalUsersEl.innerText = "0";
      return;
    }

    createSelect.innerHTML = `<option value="">-- Choose Customer --</option>`;
    if (historySelect) {
      historySelect.innerHTML = `<option value="">All Users</option>`;
    }

    // Populate dropdown with Name, Phone, and UID
    usersSnapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const uid = docSnap.id;
      cachedUsers.set(uid, data);

      const name = data.name || data.fullName || "Unnamed Customer";
      const phone = data.phone || data.phoneNumber || "";
      const uidDisplay = `[${uid.slice(0, 6)}...]`;

      let fullLabel = name;
      if (phone) {
        fullLabel += ` (${phone})`;
      }
      fullLabel += ` ${uidDisplay}`;

      // Customer selection for Create New Loan
      const opt = new Option(fullLabel, uid);
      createSelect.add(opt);

      // Customer filter for Loan Monitoring
      if (historySelect) {
        const filterLabel = phone ? `${name} (${phone})` : name;
        historySelect.add(new Option(filterLabel, uid));
      }
    });

    if (totalUsersEl) {
      totalUsersEl.innerText = cachedUsers.size;
    }

  } catch (error) {
    console.error("Error loading users from Firestore:", error);
    if (createSelect) {
      createSelect.innerHTML = `<option value="">Error: ${escapeHtml(error.code || error.message)}</option>`;
    }
    if (totalUsersEl) totalUsersEl.innerText = "Error";

    if (error.code === "permission-denied") {
      showErrorBanner("Permission Denied: Unable to read 'users' collection. Please ensure your account has administrator privileges in Firestore.");
    } else {
      showErrorBanner(`Failed to load users: ${error.message}`);
    }
  }
}

/* ================= LOAD LOANS & COMPUTE STATISTICS ================= */
async function loadLoansAndSummary() {
  const activeLoansEl = document.getElementById("totalActiveLoans");
  const outstandingEl = document.getElementById("totalOutstanding");
  const closedLoansEl = document.getElementById("totalClosedLoans");
  const historyTable = document.getElementById("loanHistoryTable");

  try {
    // Loans are stored in the 'loans' Firestore collection
    const loansSnap = await getDocs(collection(db, "loans"));
    cachedLoans = [];

    let activeCount = 0;
    let closedCount = 0;
    let totalOutstanding = 0;

    loansSnap.forEach((docSnap) => {
      const loanData = docSnap.data();
      const loan = { id: docSnap.id, ...loanData };
      cachedLoans.push(loan);

      const status = (loan.status || "").toLowerCase().trim();
      const remaining = Number(loan.remainingAmount ?? loan.totalWithInterest ?? loan.principal ?? 0);

      if (status === "closed" || remaining <= 0) {
        closedCount++;
      } else {
        activeCount++;
        totalOutstanding += remaining > 0 ? remaining : 0;
      }
    });

    // Update Dashboard Statistics Cards with real computed data
    if (activeLoansEl) activeLoansEl.innerText = activeCount;
    if (closedLoansEl) closedLoansEl.innerText = closedCount;
    if (outstandingEl) outstandingEl.innerText = formatCurrency(totalOutstanding);

    // Render Loan Monitoring table with current filter (default: All Users)
    const currentFilter = document.getElementById("historyUserSelect")?.value || "";
    renderLoanMonitoringTable(currentFilter);

  } catch (error) {
    console.error("Error loading loans from Firestore:", error);
    if (activeLoansEl) activeLoansEl.innerText = "Error";
    if (closedLoansEl) closedLoansEl.innerText = "Error";
    if (outstandingEl) outstandingEl.innerText = "Error";

    if (historyTable) {
      historyTable.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:30px; color:#ef4444;">Failed to load loans: ${escapeHtml(error.message)}</td></tr>`;
    }

    if (error.code === "permission-denied") {
      showErrorBanner("Permission Denied: Unable to read 'loans' collection. Verify Firestore security rules for admin access.");
    } else {
      showErrorBanner(`Failed to load loans: ${error.message}`);
    }
  }
}

/* ================= RENDER LOAN MONITORING TABLE ================= */
function renderLoanMonitoringTable(filterUserId = "") {
  const tbody = document.getElementById("loanHistoryTable");
  if (!tbody) return;

  let loansToDisplay = cachedLoans;
  if (filterUserId) {
    loansToDisplay = cachedLoans.filter(loan => loan.userId === filterUserId);
  }

  if (loansToDisplay.length === 0) {
    const emptyMessage = filterUserId
      ? "No loan records found for the selected customer."
      : "No loan records found in Firestore.";
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:40px; color:var(--text-muted);">${emptyMessage}</td></tr>`;
    return;
  }

  // Sort loans by date descending if available
  loansToDisplay.sort((a, b) => {
    const dateA = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.startDate || a.createdAt || 0);
    const dateB = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.startDate || b.createdAt || 0);
    return dateB - dateA;
  });

  let html = "";
  loansToDisplay.forEach((loan) => {
    const loanId = loan.id;
    const userData = cachedUsers.get(loan.userId);

    // Column 1: Customer Details (Name, Phone, UID)
    const custName = userData?.name || userData?.fullName || "Customer";
    const custPhone = userData?.phone || userData?.phoneNumber || "";
    const custUid = loan.userId ? `UID: ${loan.userId.slice(0, 8)}...` : `Loan: #${loanId.slice(0, 6)}`;

    const customerCell = `
      <div>
        <strong>${escapeHtml(custName)}</strong>
        <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">
          ${custPhone ? `${escapeHtml(custPhone)} &bull; ` : ''}${escapeHtml(custUid)}
        </div>
      </div>
    `;

    // Column 2: Remaining Balance & Total
    const remaining = Number(loan.remainingAmount ?? loan.totalWithInterest ?? loan.principal ?? 0);
    const total = Number(loan.totalWithInterest ?? loan.principal ?? 0);
    const remainingCell = `
      <div>
        <strong style="color:var(--text-main); font-size:15px;">${formatCurrency(remaining)}</strong>
        <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">
          Total: ${formatCurrency(total)}
        </div>
      </div>
    `;

    // Column 3: Status Badge
    const rawStatus = (loan.status || "").toLowerCase().trim();
    const isActive = rawStatus === "active" && remaining > 0;
    const statusBadge = isActive
      ? `<span class="badge-active">Active</span>`
      : `<span style="background:#f1f5f9; color:#475569; padding:4px 8px; border-radius:6px; font-size:12px; font-weight:600;">Closed</span>`;

    // Column 4: Action Button
    const actionCell = `
      <a href="admin_user_details.html?loanId=${encodeURIComponent(loanId)}" class="btn-primary" style="display:inline-block; text-align:center; text-decoration:none; padding:7px 14px; font-size:12px; width:auto; border-radius:6px;">
        Ledger / Pay
      </a>
    `;

    html += `
      <tr>
        <td>${customerCell}</td>
        <td>${remainingCell}</td>
        <td>${statusBadge}</td>
        <td>${actionCell}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

/* ================= INITIAL LOAD COORDINATOR ================= */
async function loadDashboardData() {
  setLoadingState();
  await loadUsers();
  await loadLoansAndSummary();
}

/* ================= BFCACHE & BACK NAVIGATION PROTECTION ================= */
window.addEventListener("pageshow", (event) => {
  // If page was restored from browser Back-Forward cache after logout, force reload to re-run auth check
  if (event.persisted) {
    window.location.reload();
  }
});

/* ================= ADMIN AUTH & SESSION VERIFICATION ================= */
onAuthStateChanged(auth, async (user) => {
  const mainEl = document.querySelector(".main-content");

  if (!user) {
    if (mainEl) mainEl.style.display = "none";
    window.location.replace("admin-login.html");
    return;
  }

  try {
    let isAdmin = false;

    // Primary check: Check 'admins' collection by UID
    try {
      const adminSnap = await getDoc(doc(db, "admins", user.uid));
      if (adminSnap.exists()) {
        isAdmin = true;
      }
    } catch (checkErr) {
      console.warn("Could not check 'admins' collection:", checkErr.message);
    }

    // Secondary fallback: Check 'users' collection for role == 'admin'
    if (!isAdmin) {
      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists() && userSnap.data()?.role === "admin") {
          isAdmin = true;
        }
      } catch (checkErr) {
        console.warn("Could not check 'users' collection role:", checkErr.message);
      }
    }

    if (!isAdmin) {
      if (mainEl) mainEl.style.display = "none";
      alert("Access Denied: Your account does not have administrator privileges.");
      await signOut(auth);
      window.location.replace("admin-login.html");
      return;
    }

    clearErrorBanner();

    // Reveal protected dashboard content now that admin is verified
    if (mainEl) mainEl.style.display = "block";

    // Hook filter change event
    const historyFilter = document.getElementById("historyUserSelect");
    if (historyFilter) {
      historyFilter.addEventListener("change", (e) => {
        renderLoanMonitoringTable(e.target.value);
      });
    }

    // Load actual Firestore data
    await loadDashboardData();

  } catch (error) {
    console.error("Authentication verification error:", error);
    showErrorBanner(`Admin verification failed: ${error.message}`);
  }
});

/* ================= CREATE NEW LOAN ================= */
window.createLoan = async function () {
  const userSelect = document.getElementById("userId");
  const userId = userSelect ? userSelect.value : "";
  const principalInput = document.getElementById("principal");
  const rateInput = document.getElementById("interest");
  const monthsInput = document.getElementById("months");

  const principal = parseFloat(principalInput?.value);
  const rate = parseFloat(rateInput?.value);
  const months = parseInt(monthsInput?.value, 10);

  if (!userId) {
    alert("Please select a registered customer.");
    return;
  }

  if (isNaN(principal) || principal <= 0) {
    alert("Please enter a valid principal amount greater than 0.");
    principalInput?.focus();
    return;
  }

  if (isNaN(rate) || rate < 0) {
    alert("Please enter a valid interest rate.");
    rateInput?.focus();
    return;
  }

  if (isNaN(months) || months <= 0) {
    alert("Please enter a duration of at least 1 month.");
    monthsInput?.focus();
    return;
  }

  const interestAmount = (principal * rate * months) / 100;
  const total = principal + interestAmount;

  try {
    await addDoc(collection(db, "loans"), {
      userId,
      principal,
      interestRate: rate,
      months,
      totalWithoutInterest: principal,
      totalWithInterest: total,
      remainingAmount: total,
      status: "active",
      startDate: new Date().toISOString(),
      createdAt: serverTimestamp()
    });

    alert("Loan Agreement Generated Successfully!");

    // Reset input fields
    if (principalInput) principalInput.value = "";
    if (rateInput) rateInput.value = "2";
    if (monthsInput) monthsInput.value = "12";

    // Refresh real Firestore dashboard statistics & loan records
    await loadLoansAndSummary();

  } catch (error) {
    console.error("Error creating loan:", error);
    alert(`Failed to create loan: ${error.message}`);
    showErrorBanner(`Failed to create loan: ${error.message}`);
  }
};

/* ================= NAVIGATION & ACTIONS ================= */
window.toggleAdminCreate = function () {
  window.location.href = "admin_register.html";
};

window.logout = async function () {
  const mainEl = document.querySelector(".main-content");
  if (mainEl) mainEl.style.display = "none";

  try {
    await signOut(auth);
  } catch (error) {
    console.error("Logout error:", error);
  }

  try {
    sessionStorage.clear();
  } catch (e) {}

  window.location.replace("admin-login.html");
};

// Safe modal fallbacks for backwards compatibility
window.openLedgerModal = function (loanId) {
  if (loanId) {
    window.location.href = `admin_user_details.html?loanId=${encodeURIComponent(loanId)}`;
  }
};

window.openPaymentModal = function (loanId) {
  if (loanId) {
    window.location.href = `admin_user_details.html?loanId=${encodeURIComponent(loanId)}`;
  }
};

window.closeLedgerModal = () => {};
window.closePaymentModal = () => {};
