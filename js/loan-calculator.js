/**
 * Gayatri Electronics Loan Management System — Loan Calculation Engine
 * Reference: Gayatri_Electronics_Loan_System_Plan.md (Phase 2 Financial Rules)
 * 
 * Standalone financial engine supporting:
 * 1. calculateAccruedInterest(tranches, asOfDate)
 * 2. validatePaymentAllocation(paymentAmount, interestAllocated, principalAllocated)
 * 3. calculateOutstandingBalances(tranches, payments, asOfDate)
 * 4. calculateDueDateStatus(dueDate, asOfDate)
 * 
 * Rules:
 * - 30-day fixed periodic cycle on original principal (Day 1-30 = 1 period; Day 31 = 2 periods, etc.).
 * - Interest boundary normalized to calendar-day midnight so Day 31, 61, 91 start at 00:00:00 local time.
 * - Unpaid interest carries forward without compounding.
 * - Integer-paise 2-decimal precision (avoids floating-point arithmetic errors).
 * - Exact payment allocation validation (interestAllocated + principalAllocated === paymentAmount).
 * - Chronological ascending processing of payments; invalid/missing payment dates explicitly reported.
 * - Per-tranche remaining principal tracking without arbitrary allocation guessing.
 * - Legacy unallocated payments preserved without synthetic splitting.
 * - Overpayments explicitly reported with non-negative balance clamping.
 * - Optional due date with 7-day warning threshold and overdue evaluation.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Rounds a number to exactly two decimal places.
 * @param {number|string} num 
 * @returns {number}
 */
export function round2(num) {
    const val = Number(num);
    if (isNaN(val)) return 0;
    return Math.round(val * 100) / 100;
}

/**
 * Converts a monetary number to integer paise to eliminate floating-point errors.
 * @param {number|string} num 
 * @returns {number} Integer paise
 */
export function toPaise(num) {
    const val = Number(num);
    if (isNaN(val)) return 0;
    return Math.round(val * 100);
}

/**
 * Normalizes a Date to calendar-day midnight (00:00:00.000 local time).
 * Ensures date comparisons and period thresholds depend strictly on calendar days,
 * regardless of the time of day disbursement or payment occurred.
 * 
 * @param {Date|null} date 
 * @returns {Date|null}
 */
export function toCalendarMidnight(date) {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Normalizes varied date formats into a standard JavaScript Date object.
 * Supports:
 * - Firestore Timestamp instances (.toDate())
 * - Plain objects { seconds, nanoseconds }
 * - JavaScript Date instances
 * - Numeric epoch timestamps (seconds or milliseconds)
 * - ISO-8601 strings (e.g. "2026-10-20T10:00:00.000Z", "2026-10-20")
 * - Legacy Indian date strings ("DD/MM/YYYY", "DD-MM-YYYY" with optional time)
 * - Legacy date strings ("YYYY/MM/DD")
 * 
 * @param {*} raw 
 * @returns {Date|null}
 */
export function normalizeDate(raw) {
    if (!raw) return null;

    // 1. Firestore Timestamp instance
    if (typeof raw.toDate === "function") {
        try {
            const d = raw.toDate();
            return isNaN(d.getTime()) ? null : d;
        } catch (e) {
            return null;
        }
    }

    // 2. Plain Firestore Timestamp object { seconds, nanoseconds }
    if (typeof raw.seconds === "number") {
        const ms = (raw.seconds * 1000) + (raw.nanoseconds ? Math.floor(raw.nanoseconds / 1000000) : 0);
        const d = new Date(ms);
        return isNaN(d.getTime()) ? null : d;
    }

    // 3. JavaScript Date instance
    if (raw instanceof Date) {
        return isNaN(raw.getTime()) ? null : raw;
    }

    // 4. Numeric epoch timestamp
    if (typeof raw === "number") {
        const ms = raw > 1e11 ? raw : raw * 1000;
        const d = new Date(ms);
        return isNaN(d.getTime()) ? null : d;
    }

    // 5. String parsing
    if (typeof raw === "string") {
        const trimmed = raw.trim();
        if (!trimmed) return null;

        // Try native standard parse (ISO 8601, RFC2822, YYYY-MM-DD)
        const parsed = Date.parse(trimmed);
        if (!isNaN(parsed)) {
            return new Date(parsed);
        }

        // DD/MM/YYYY or DD-MM-YYYY with optional time
        const dmyMatch = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
        if (dmyMatch) {
            const day = parseInt(dmyMatch[1], 10);
            const month = parseInt(dmyMatch[2], 10) - 1;
            const year = parseInt(dmyMatch[3], 10);
            const hour = dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 0;
            const min = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
            const sec = dmyMatch[6] ? parseInt(dmyMatch[6], 10) : 0;
            const d = new Date(year, month, day, hour, min, sec);
            return isNaN(d.getTime()) ? null : d;
        }

        // YYYY/MM/DD with optional time
        const ymdMatch = trimmed.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
        if (ymdMatch) {
            const year = parseInt(ymdMatch[1], 10);
            const month = parseInt(ymdMatch[2], 10) - 1;
            const day = parseInt(ymdMatch[3], 10);
            const hour = ymdMatch[4] ? parseInt(ymdMatch[4], 10) : 0;
            const min = ymdMatch[5] ? parseInt(ymdMatch[5], 10) : 0;
            const sec = ymdMatch[6] ? parseInt(ymdMatch[6], 10) : 0;
            const d = new Date(year, month, day, hour, min, sec);
            return isNaN(d.getTime()) ? null : d;
        }
    }

    return null;
}

/**
 * Helper to normalize tranche inputs from multiple formats:
 * - Array of tranche objects
 * - Loan object containing a `tranches` array
 * - Single tranche/loan object with top-level principal & rate
 * 
 * @param {*} input 
 * @returns {Array<object>}
 */
function normalizeTranchesInput(input) {
    if (!input) return [];
    if (Array.isArray(input)) return input;
    if (typeof input === "object") {
        if (Array.isArray(input.tranches)) return input.tranches;
        return [input];
    }
    return [];
}

/**
 * 1. Calculates the accrued interest for a set of tranches as of a given date.
 * 
 * Financial Rules:
 * - Fixed monthly interest rate applied to that tranche's ORIGINAL principal.
 * - Strict 30-day periods. Day 1–30 has 1 period's interest.
 * - Normalized to calendar-day boundary: Day 31, 61, 91 start at 00:00:00 local time.
 * - If asOfDate is before the tranche start date, accrued interest is 0.
 * 
 * @param {Array<object>|object} tranches - Array of tranches or single tranche/loan object.
 *        Each tranche expects: { principal, interestRate, startDate (or disbursementDate) }
 * @param {Date|string|number} [asOfDate=new Date()] - Evaluation date/time.
 * @returns {object} {
 *    totalAccruedInterest: number,
 *    trancheBreakdown: Array<{
 *       trancheId: string,
 *       originalPrincipal: number,
 *       interestRate: number,
 *       startDate: Date|null,
 *       elapsedDays: number,
 *       periodsDue: number,
 *       interestPerPeriod: number,
 *       accruedInterest: number,
 *       nextInterestDate: Date|null
 *    }>,
 *    asOfDate: Date,
 *    valueOf: Function (returns totalAccruedInterest for numeric evaluation)
 * }
 */
export function calculateAccruedInterest(tranches, asOfDate = new Date()) {
    const normalizedAsOf = normalizeDate(asOfDate) || new Date();
    const asOfMidnight = toCalendarMidnight(normalizedAsOf);
    const trancheList = normalizeTranchesInput(tranches);

    let totalAccruedPaise = 0;
    const trancheBreakdown = [];

    trancheList.forEach((tranche, idx) => {
        const principal = round2(tranche.principal || tranche.originalPrincipal || tranche.amount || 0);
        const rate = Number(tranche.interestRate ?? tranche.rate ?? 0);
        const rawStartDate = normalizeDate(tranche.startDate || tranche.disbursementDate || tranche.date || tranche.createdAt);
        const trancheId = tranche.id || tranche.trancheId || `tranche_${idx + 1}`;

        if (principal <= 0 || rate <= 0 || !rawStartDate) {
            trancheBreakdown.push({
                trancheId,
                originalPrincipal: principal,
                interestRate: rate,
                startDate: rawStartDate,
                elapsedDays: 0,
                periodsDue: 0,
                interestPerPeriod: 0,
                accruedInterest: 0,
                nextInterestDate: null
            });
            return;
        }

        const startMidnight = toCalendarMidnight(rawStartDate);

        // If evaluation date calendar day is before disbursement calendar day, no interest is due yet
        if (asOfMidnight.getTime() < startMidnight.getTime()) {
            const interestPerPeriod = round2((principal * rate) / 100);
            trancheBreakdown.push({
                trancheId,
                originalPrincipal: principal,
                interestRate: rate,
                startDate: rawStartDate,
                elapsedDays: 0,
                periodsDue: 0,
                interestPerPeriod,
                accruedInterest: 0,
                nextInterestDate: rawStartDate
            });
            return;
        }

        // Calendar-day normalized elapsed days: Day 1 (disbursement date) = 0 elapsed days
        const elapsedDays = Math.round((asOfMidnight.getTime() - startMidnight.getTime()) / MS_PER_DAY);
        // Day 1 to Day 30 (elapsed 0 to 29) = 1 period; Day 31 (elapsed 30) = 2 periods; Day 61 (elapsed 60) = 3 periods
        const periodsDue = 1 + Math.floor(elapsedDays / 30);
        const interestPerPeriod = round2((principal * rate) / 100);
        const accruedInterest = round2(interestPerPeriod * periodsDue);

        totalAccruedPaise += toPaise(accruedInterest);

        // Next interest boundary date (when periodsDue increments at midnight: startMidnight + periodsDue * 30 days)
        const nextInterestDate = new Date(startMidnight.getFullYear(), startMidnight.getMonth(), startMidnight.getDate() + (periodsDue * 30));

        trancheBreakdown.push({
            trancheId,
            originalPrincipal: principal,
            interestRate: rate,
            startDate: rawStartDate,
            elapsedDays,
            periodsDue,
            interestPerPeriod,
            accruedInterest,
            nextInterestDate
        });
    });

    const totalAccruedInterest = totalAccruedPaise / 100;

    return {
        totalAccruedInterest,
        trancheBreakdown,
        asOfDate: normalizedAsOf,
        valueOf() {
            return this.totalAccruedInterest;
        }
    };
}

/**
 * 2. Validates that a received payment allocation between interest and principal is exact and valid.
 * 
 * Financial Rules:
 * - Payment amount must be strictly greater than 0.
 * - Neither interest allocation nor principal allocation can be negative.
 * - interestAllocated + principalAllocated must equal paymentAmount exactly (to 2 decimal places / paise).
 * 
 * @param {number|string} paymentAmount - Total payment collected.
 * @param {number|string} interestAllocated - Portion allocated to interest.
 * @param {number|string} principalAllocated - Portion allocated to principal.
 * @returns {object} {
 *    isValid: boolean,
 *    error?: string,
 *    paymentAmount?: number,
 *    interestAllocated?: number,
 *    principalAllocated?: number
 * }
 */
export function validatePaymentAllocation(paymentAmount, interestAllocated, principalAllocated) {
    const amt = Number(paymentAmount);
    const intAlloc = Number(interestAllocated);
    const priAlloc = Number(principalAllocated);

    if (isNaN(amt) || isNaN(intAlloc) || isNaN(priAlloc)) {
        return {
            isValid: false,
            error: "Payment amount and allocations must be valid numbers."
        };
    }

    const paymentPaise = toPaise(amt);
    const interestPaise = toPaise(intAlloc);
    const principalPaise = toPaise(priAlloc);

    if (paymentPaise <= 0) {
        return {
            isValid: false,
            error: "Payment amount must be greater than zero."
        };
    }

    if (interestPaise < 0) {
        return {
            isValid: false,
            error: "Interest allocation cannot be negative."
        };
    }

    if (principalPaise < 0) {
        return {
            isValid: false,
            error: "Principal allocation cannot be negative."
        };
    }

    const allocatedTotalPaise = interestPaise + principalPaise;

    if (allocatedTotalPaise !== paymentPaise) {
        const diffPaise = Math.abs(paymentPaise - allocatedTotalPaise);
        const diffFormatted = (diffPaise / 100).toFixed(2);
        const expectedFormatted = (paymentPaise / 100).toFixed(2);
        const allocatedFormatted = (allocatedTotalPaise / 100).toFixed(2);

        return {
            isValid: false,
            error: `Interest allocation (₹${(interestPaise / 100).toFixed(2)}) plus principal allocation (₹${(principalPaise / 100).toFixed(2)}) must equal total payment (₹${expectedFormatted}). Allocated: ₹${allocatedFormatted}. Discrepancy: ₹${diffFormatted}.`
        };
    }

    return {
        isValid: true,
        paymentAmount: paymentPaise / 100,
        interestAllocated: interestPaise / 100,
        principalAllocated: principalPaise / 100
    };
}

/**
 * 3. Calculates current outstanding balances, paid totals, and closure status for a loan.
 * 
 * Financial Rules:
 * - Total Original Principal = sum of all tranche principals.
 * - Total Accrued Interest = calculated using 30-day fixed periodic cycles on original principals.
 * - Total Principal Paid = sum of payment principal allocations.
 * - Total Interest Paid = sum of payment interest allocations.
 * - Remaining Principal = Math.max(0, Total Original Principal - Total Principal Paid).
 * - Unpaid Interest = Math.max(0, Total Accrued Interest - Total Interest Paid).
 * - Total Outstanding = Remaining Principal + Unpaid Interest (strictly non-negative).
 * - Excess Payments = tracked explicitly when totalPrincipalPaid > originalPrincipal or totalInterestPaid > accruedInterest.
 * - Automatic Closure: Loan is closed only when remainingPrincipal === 0 and unpaidInterest === 0.
 * - Chronological payments: Payments are processed in ascending chronological order. Invalid dates are explicitly reported.
 * - Per-tranche balances: remainingPrincipal is reported per tranche; for multi-tranche loans without tranche allocation,
 *   limitation is explicitly reported with remainingPrincipal: null rather than guessing.
 * - Legacy payments: Unallocated payments are preserved in totalAmountPaid and totalLegacyAmountPaid without synthetic splitting.
 * 
 * @param {Array<object>|object} tranches - Tranche(s) or loan object.
 * @param {Array<object>} [payments=[]] - Payment records.
 * @param {Date|string|number} [asOfDate=new Date()] - As-of evaluation date/time.
 * @returns {object}
 */
export function calculateOutstandingBalances(tranches, payments = [], asOfDate = new Date()) {
    const normalizedAsOf = normalizeDate(asOfDate) || new Date();
    const asOfMs = normalizedAsOf.getTime();
    const trancheList = normalizeTranchesInput(tranches);
    const paymentList = Array.isArray(payments) ? payments : [];

    // Calculate accrued interest across tranches
    const interestData = calculateAccruedInterest(trancheList, normalizedAsOf);
    const totalAccruedInterest = interestData.totalAccruedInterest;

    let totalOriginalPrincipalPaise = 0;
    const trancheMap = new Map();

    trancheList.forEach((t, idx) => {
        const tid = t.id || t.trancheId || `tranche_${idx + 1}`;
        const pPaise = toPaise(t.principal || t.originalPrincipal || t.amount || 0);
        totalOriginalPrincipalPaise += pPaise;
        trancheMap.set(tid, {
            trancheId: tid,
            principalPaise: pPaise,
            principalPaidPaise: 0
        });
    });

    // 1. Validate & categorize payments (Chronological payments requirement)
    const validPayments = [];
    const invalidPayments = [];
    const futurePayments = [];

    paymentList.forEach((pay, idx) => {
        if (!pay || typeof pay !== "object") {
            invalidPayments.push({
                index: idx,
                payment: pay,
                reason: "Payment record is not an object or is null/undefined"
            });
            return;
        }

        const payDate = normalizeDate(pay.paymentDate || pay.date || pay.createdAt);
        if (!payDate) {
            invalidPayments.push({
                index: idx,
                payment: pay,
                reason: "Missing or invalid payment date"
            });
            return;
        }

        // Payments recorded with a timestamp after asOfDate are future payments relative to asOfDate
        if (payDate.getTime() > asOfMs) {
            futurePayments.push({
                index: idx,
                payment: pay,
                paymentDate: payDate
            });
            return;
        }

        validPayments.push({
            ...pay,
            _normalizedDate: payDate,
            _index: idx
        });
    });

    // 2. Sort valid payments in ascending chronological order (stable secondary sort on original index)
    validPayments.sort((a, b) => a._normalizedDate.getTime() - b._normalizedDate.getTime() || a._index - b._index);

    let totalPrincipalPaidPaise = 0;
    let totalInterestPaidPaise = 0;
    let totalAmountPaidPaise = 0;
    let totalLegacyAmountPaidPaise = 0;
    let legacyPaymentsCount = 0;
    let hasUnassignedTranchePayments = false;
    let unassignedTranchePaymentsCount = 0;
    let unassignedPrincipalPaidPaise = 0;

    // 3. Process chronological valid payments
    validPayments.forEach((pay) => {
        const amt = round2(pay.amount || pay.paidAmount || 0);
        totalAmountPaidPaise += toPaise(amt);

        const hasAllocations = (pay.principalAllocated !== undefined || pay.interestAllocated !== undefined);

        // Legacy payment handling: do not automatically split into principal or interest
        if (!hasAllocations) {
            legacyPaymentsCount++;
            totalLegacyAmountPaidPaise += toPaise(amt);
            return;
        }

        const priAlloc = round2(pay.principalAllocated || 0);
        const intAlloc = round2(pay.interestAllocated || 0);
        const priAllocPaise = toPaise(priAlloc);
        const intAllocPaise = toPaise(intAlloc);

        totalPrincipalPaidPaise += priAllocPaise;
        totalInterestPaidPaise += intAllocPaise;

        // Tranche allocation
        if (trancheList.length === 1) {
            const singleTranche = trancheMap.values().next().value;
            if (singleTranche) {
                singleTranche.principalPaidPaise += priAllocPaise;
            }
        } else if (trancheList.length > 1) {
            const targetTrancheId = pay.trancheId || pay.tranche_id || pay.relatedTranche;
            if (targetTrancheId && trancheMap.has(targetTrancheId)) {
                trancheMap.get(targetTrancheId).principalPaidPaise += priAllocPaise;
            } else if (priAllocPaise > 0) {
                hasUnassignedTranchePayments = true;
                unassignedTranchePaymentsCount++;
                unassignedPrincipalPaidPaise += priAllocPaise;
            }
        }
    });

    // 4. Excess payments calculation (Rule 5)
    const excessPrincipalPaise = Math.max(0, totalPrincipalPaidPaise - totalOriginalPrincipalPaise);
    const excessInterestPaise = Math.max(0, totalInterestPaidPaise - toPaise(totalAccruedInterest));
    const totalExcessPaise = excessPrincipalPaise + excessInterestPaise;

    // 5. Remaining balances: strictly non-negative
    const remainingPrincipalPaise = Math.max(0, totalOriginalPrincipalPaise - totalPrincipalPaidPaise);
    const unpaidInterestPaise = Math.max(0, toPaise(totalAccruedInterest) - totalInterestPaidPaise);
    const totalOutstandingPaise = remainingPrincipalPaise + unpaidInterestPaise;

    const remainingPrincipal = remainingPrincipalPaise / 100;
    const unpaidInterest = unpaidInterestPaise / 100;
    const totalOutstanding = totalOutstandingPaise / 100;

    const totalExcessPaid = totalExcessPaise / 100;
    const excessPrincipalPaid = excessPrincipalPaise / 100;
    const excessInterestPaid = excessInterestPaise / 100;

    // Automatic closure: both remaining principal and unpaid interest must equal 0.00
    const isClosed = (remainingPrincipalPaise === 0 && unpaidInterestPaise === 0 && totalOriginalPrincipalPaise > 0);

    // 6. Build tranche breakdown with per-tranche principalPaid & remainingPrincipal
    const trancheBreakdown = interestData.trancheBreakdown.map((tInfo) => {
        const tData = trancheMap.get(tInfo.trancheId);
        let principalPaid = null;
        let remainingPrincipal = null;
        let excessPrincipalPaid = 0;
        let trancheAllocationStatus = "allocated";

        if (trancheList.length === 1) {
            principalPaid = tData ? tData.principalPaidPaise / 100 : 0;
            const remPaise = Math.max(0, (tData ? tData.principalPaise : 0) - (tData ? tData.principalPaidPaise : 0));
            const excessPaise = Math.max(0, (tData ? tData.principalPaidPaise : 0) - (tData ? tData.principalPaise : 0));
            remainingPrincipal = remPaise / 100;
            excessPrincipalPaid = excessPaise / 100;
            trancheAllocationStatus = "single_tranche";
        } else if (hasUnassignedTranchePayments) {
            // Cannot safely determine remainingPrincipal without inventing an allocation rule
            principalPaid = tData ? tData.principalPaidPaise / 100 : 0;
            remainingPrincipal = null;
            excessPrincipalPaid = 0;
            trancheAllocationStatus = "unassigned_payments_present";
        } else {
            // Multi-tranche with all principal payments identified by trancheId
            principalPaid = tData ? tData.principalPaidPaise / 100 : 0;
            const remPaise = Math.max(0, (tData ? tData.principalPaise : 0) - (tData ? tData.principalPaidPaise : 0));
            const excessPaise = Math.max(0, (tData ? tData.principalPaidPaise : 0) - (tData ? tData.principalPaise : 0));
            remainingPrincipal = remPaise / 100;
            excessPrincipalPaid = excessPaise / 100;
            trancheAllocationStatus = "allocated";
        }

        return {
            ...tInfo,
            principalPaid,
            remainingPrincipal,
            excessPrincipalPaid,
            trancheAllocationStatus
        };
    });

    return {
        totalOriginalPrincipal: totalOriginalPrincipalPaise / 100,
        totalAccruedInterest,
        totalPrincipalPaid: totalPrincipalPaidPaise / 100,
        totalInterestPaid: totalInterestPaidPaise / 100,
        totalAmountPaid: totalAmountPaidPaise / 100,
        remainingPrincipal,
        unpaidInterest,
        totalOutstanding,
        isClosed,
        status: isClosed ? "closed" : "active",
        hasExcessPayment: totalExcessPaise > 0,
        excessPayment: totalExcessPaid,
        excessPrincipalPaid,
        excessInterestPaid,
        asOfDate: normalizedAsOf,
        trancheBreakdown,
        paymentCount: paymentList.length,
        processedPaymentsCount: validPayments.length,
        legacyPaymentsCount,
        totalLegacyAmountPaid: totalLegacyAmountPaidPaise / 100,
        hasUnallocatedPayments: legacyPaymentsCount > 0,
        legacyPaymentNote: legacyPaymentsCount > 0
            ? "Legacy payments without explicit principal/interest allocation are preserved in totalAmountPaid and totalLegacyAmountPaid, but are not automatically split into principal or interest."
            : null,
        invalidPayments,
        invalidPaymentCount: invalidPayments.length,
        hasInvalidPayments: invalidPayments.length > 0,
        futurePaymentsCount: futurePayments.length,
        hasUnassignedTranchePayments,
        unassignedTranchePaymentsCount,
        unassignedPrincipalPaid: unassignedPrincipalPaidPaise / 100,
        trancheAllocationLimitation: hasUnassignedTranchePayments
            ? "Some payments did not identify a specific trancheId. Individual tranche remaining principal cannot be safely determined without an agreed allocation rule."
            : null
    };
}

/**
 * 4. Calculates optional repayment due date countdown and overdue status.
 * 
 * Financial Rules:
 * - Due date is optional. If missing/null/empty, no false warnings or countdowns are shown.
 * - Prominent warning starts exactly 7 days before due date.
 * - Once the date passes, status becomes "Overdue".
 * - Due date is a reminder only; it does not stop interest accrual or close the loan.
 * 
 * @param {Date|string|number|null|undefined} dueDate - Optional promised repayment date.
 * @param {Date|string|number} [asOfDate=new Date()] - As-of evaluation date/time.
 * @returns {object} {
 *    hasDueDate: boolean,
 *    dueDate: Date|null,
 *    daysRemaining: number|null,
 *    daysOverdue: number,
 *    isWarning: boolean,
 *    isOverdue: boolean,
 *    status: "none"|"upcoming"|"warning"|"overdue",
 *    statusLabel: string,
 *    badgeClass: string
 * }
 */
export function calculateDueDateStatus(dueDate, asOfDate = new Date()) {
    if (!dueDate) {
        return {
            hasDueDate: false,
            dueDate: null,
            daysRemaining: null,
            daysOverdue: 0,
            isWarning: false,
            isOverdue: false,
            status: "none",
            statusLabel: "No Due Date",
            badgeClass: "badge-neutral"
        };
    }

    const normalizedDue = normalizeDate(dueDate);
    const normalizedAsOf = normalizeDate(asOfDate) || new Date();

    if (!normalizedDue) {
        return {
            hasDueDate: false,
            dueDate: null,
            daysRemaining: null,
            daysOverdue: 0,
            isWarning: false,
            isOverdue: false,
            status: "none",
            statusLabel: "No Due Date",
            badgeClass: "badge-neutral"
        };
    }

    // Compare calendar dates (midnight to midnight)
    const dueMidnight = toCalendarMidnight(normalizedDue);
    const asOfMidnight = toCalendarMidnight(normalizedAsOf);
    const diffDays = Math.round((dueMidnight.getTime() - asOfMidnight.getTime()) / MS_PER_DAY);

    // Overdue: Due date is in the past
    if (diffDays < 0) {
        const daysOverdue = Math.abs(diffDays);
        return {
            hasDueDate: true,
            dueDate: normalizedDue,
            daysRemaining: diffDays,
            daysOverdue,
            isWarning: true,
            isOverdue: true,
            status: "overdue",
            statusLabel: `Overdue by ${daysOverdue} day${daysOverdue === 1 ? '' : 's'}`,
            badgeClass: "badge-overdue"
        };
    }

    // 7-day Warning threshold: Due today or within 7 days
    if (diffDays <= 7) {
        const label = diffDays === 0 ? "Due Today" : `Due in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
        return {
            hasDueDate: true,
            dueDate: normalizedDue,
            daysRemaining: diffDays,
            daysOverdue: 0,
            isWarning: true,
            isOverdue: false,
            status: "warning",
            statusLabel: label,
            badgeClass: "badge-warning"
        };
    }

    // Normal upcoming due date (more than 7 days remaining)
    return {
        hasDueDate: true,
        dueDate: normalizedDue,
        daysRemaining: diffDays,
        daysOverdue: 0,
        isWarning: false,
        isOverdue: false,
        status: "upcoming",
        statusLabel: `Due in ${diffDays} days`,
        badgeClass: "badge-normal"
    };
}

export default {
    round2,
    toPaise,
    toCalendarMidnight,
    normalizeDate,
    calculateAccruedInterest,
    validatePaymentAllocation,
    calculateOutstandingBalances,
    calculateDueDateStatus
};
