package detector

// defaultRules returns the built-in regex catalogue. These are conservative
// patterns; post-validators (Verhoeff for Aadhaar, Luhn for cards) live in
// validators.go and are referenced by name.
//
// Categories used (used by the policy engine):
//
//	PII-IN  — India-specific PII (Aadhaar, PAN, ABHA)
//	PII     — generic PII (mobile, email)
//	PHI     — protected health info (MRN, ICD, Rx, lab/radiology)
//	INS     — insurance / financial id
//	FIN     — payment cards
func defaultRules() []*Rule {
	return []*Rule{
		// India-specific
		{ID: "IN.AADHAAR", Category: "PII-IN", Pattern: `\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b`, Weight: 2.0, Validator: "verhoeff"},
		{ID: "IN.PAN", Category: "PII-IN", Pattern: `\b[A-Z]{5}[0-9]{4}[A-Z]\b`, Weight: 1.5, Validator: "pan"},
		{ID: "IN.MOBILE", Category: "PII", Pattern: `(?:^|[^\d])(?:\+?91[\s-]?)?([6-9]\d{9})(?:[^\d]|$)`, Weight: 1.0},
		{ID: "IN.ABHA", Category: "PII-IN", Pattern: `\b\d{2}-\d{4}-\d{4}-\d{4}\b`, Weight: 1.5},

		// Medical
		{ID: "PHI.MRN", Category: "PHI", Pattern: `(?i)\b(?:MRN|MR#|Med\.?\s?Rec)[\s:#-]*([A-Z0-9-]{6,20})\b`, Weight: 1.5},
		{ID: "MED.ICD10", Category: "PHI", Pattern: `\b[A-TV-Z][0-9][0-9AB](?:\.[0-9A-Z]{1,4})?\b`, Weight: 0.8},
		{ID: "MED.RX", Category: "PHI", Pattern: `(?i)\b(?:tab|cap|syr|inj)\.?\s+[A-Z][a-z]+\s+\d+\s?(?:mg|mcg|ml|iu)\b`, Weight: 1.2},
		{ID: "MED.LAB", Category: "PHI", Pattern: `(?i)\b(?:CBC|HbA1c|TSH|LFT|KFT|ECG|HIV|HBsAg|HCV|RT-PCR|Troponin|Creatinine|Hemoglobin|WBC)\b`, Weight: 0.6},
		{ID: "MED.RAD", Category: "PHI", Pattern: `(?i)\b(?:MRI|CT scan|X-?ray|USG|Mammogram|PET-?CT|Ultrasound)\b`, Weight: 0.6},
		{ID: "MED.DIAG", Category: "PHI", Pattern: `(?i)\b(?:diagnosis|impression|finding|provisional)\s*:`, Weight: 0.7},
		{ID: "PHI.CLINICAL", Category: "PHI", Pattern: `(?i)\b(?:SOB|COPD|hypertension|diabetes|antibiotic|antibiotics|biopsy|MRI|CT\s|chemotherapy|surgery|ICU|emergency room|diagnosis|prescription|symptoms|pain|DM2|HTN|CKD|fever|निदान|उपचार|मरीज़|रोगी|बुखार|संक्रमण)\b`, Weight: 1.0},

		// Insurance / financial
		{ID: "INS.POLICY", Category: "INS", Pattern: `(?i)\b(?:POL|INS|PLCY)[-#:]?\s*([A-Z0-9]{6,16})\b`, Weight: 1.0},
		{ID: "FIN.CCN", Category: "FIN", Pattern: `\b(?:\d[ -]*?){13,19}\b`, Weight: 1.5, Validator: "luhn"},

		// International generic. Go's regexp (RE2) lacks lookaheads, so this
		// pattern is a superset; the ssn validator (validators.go) drops the
		// 000/666/9XX prefixes and 00 group / 0000 serial.
		{ID: "INT.SSN", Category: "PII", Pattern: `\b\d{3}-\d{2}-\d{4}\b`, Weight: 1.5, Validator: "ssn"},
		{ID: "INT.EMAIL", Category: "PII", Pattern: `\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b`, Weight: 0.4},
	}
}

// defaultDictionary is the hospital keyword dictionary built into the binary.
// Operators can extend it from configs/dictionaries/hospital.txt.
func defaultDictionary() []string {
	return []string{
		// Departments
		"Cardiology", "Oncology", "Nephrology", "Neurology", "Orthopedics",
		"Pediatrics", "Radiology", "Pulmonology", "Endocrinology", "Hematology",
		"Gastroenterology", "Dermatology", "Psychiatry", "Urology", "Gynecology",
		// Procedures
		"angioplasty", "chemotherapy", "dialysis", "biopsy", "endoscopy",
		"colonoscopy", "laparoscopy", "transplant", "cesarean", "appendectomy",
		// Drug classes / common drugs
		"atorvastatin", "metformin", "amlodipine", "amoxicillin", "azithromycin",
		"levothyroxine", "omeprazole", "ramipril", "telmisartan", "insulin",
		// Symptoms
		"chest pain", "dyspnea", "hematuria", "tachycardia", "bradycardia",
		"hyperglycemia", "hypoglycemia", "anemia", "edema", "fever",
		// Indian provider terminology
		"OPD", "IPD", "MLC", "MRD", "BHT", "discharge summary",
		"prescription", "lab report", "radiology report", "consultation",
		// PHI markers
		"patient name", "DOB", "date of birth", "admission date", "discharge date",
		// Hindi / Devanagari medical terms
		"निदान", "उपचार", "दवा", "मरीज़", "अस्पताल", "रोगी", "बुखार", "संक्रमण", "आधार", "पैन",
	}
}
