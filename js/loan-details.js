import { auth, db } from "./firebase-config.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

window.goBack = function () {
  window.location = "user-dashboard.html";
};

// Get loanId from URL
function getLoanId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("loanId");
}

onAuthStateChanged(auth, async (user) => {

  if (!user) {
    window.location = "index.html";
    return;
  }

  const loanId = getLoanId();

  if (!loanId) {
    alert("Invalid Loan ID");
    window.location = "user-dashboard.html";
    return;
  }

  try {

    // Fetch loan document
    const loanRef = doc(db, "loans", loanId);
    const loanSnap = await getDoc(loanRef);

    if (!loanSnap.exists()) {
      alert("Loan not found");
      window.location = "user-dashboard.html";
      return;
    }

    const loan = loanSnap.data();

    // Security check
    if (loan.userId !== user.uid) {
      alert("Unauthorized access");
      window.location = "user-dashboard.html";
      return;
    }

    // Show Loan Info
    document.getElementById("loanInfo").innerHTML = `
      <p><strong>Principal:</strong> ₹ ${loan.principal}</p>
      <p><strong>Interest Rate:</strong> ${loan.interestRate}%</p>
      <p><strong>Total Without Interest:</strong> ₹ ${loan.totalWithoutInterest}</p>
      <p><strong>Total With Interest:</strong> ₹ ${loan.totalWithInterest}</p>
      <p><strong>Remaining:</strong> ₹ ${loan.remainingAmount}</p>
      <p><strong>Status:</strong> ${loan.status}</p>
      <p><strong>Start Date:</strong> ${loan.startDate || "-"}</p>
      <p><strong>Closed Date:</strong> ${loan.closedDate || "-"}</p>
    `;

    // Fetch Ledger Entries (NO orderBy to avoid index issue)
    const ledgerQuery = query(
      collection(db, "ledger"),
      where("loanId", "==", loanId)
    );

    const ledgerSnap = await getDocs(ledgerQuery);

    let balance = loan.totalWithInterest;

    let tableHTML = `
      <table>
        <tr>
          <th>Date</th>
          <th>Description</th>
          <th>Debit</th>
          <th>Credit</th>
          <th>Balance</th>
        </tr>
    `;

    // First Row → Loan Given
    tableHTML += `
      <tr>
        <td>${loan.startDate || "-"}</td>
        <td>Loan Given</td>
        <td>₹ ${loan.totalWithInterest}</td>
        <td>-</td>
        <td>₹ ${balance}</td>
      </tr>
    `;

    // Collect entries
    let entries = [];

    ledgerSnap.forEach((docSnap) => {
      const data = docSnap.data();
      if (data.date && data.amount) {
        entries.push(data);
      }
    });

    // Sort entries by date (YYYY-MM-DD format expected)
    entries.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Add payment rows
    entries.forEach((entry) => {

      balance -= entry.amount;

      tableHTML += `
        <tr>
          <td>${entry.date}</td>
          <td>Payment Received</td>
          <td>-</td>
          <td>₹ ${entry.amount}</td>
          <td>₹ ${balance}</td>
        </tr>
      `;
    });

    tableHTML += `</table>`;

    document.getElementById("ledgerTable").innerHTML = tableHTML;

  } catch (error) {
    console.error(error);
    alert("Error loading loan details");
  }

});
