package detector

import (
	"strings"
	"unicode"
)

// validators is the registry of post-regex validators referenced by Rule.Validator.
var validators = map[string]func(string) bool{
	"verhoeff": ValidateAadhaar,
	"luhn":     ValidateLuhn,
	"pan":      ValidatePAN,
	"ssn":      ValidateSSN,
}

// ValidateAadhaar runs the Verhoeff checksum used by UIDAI for Aadhaar numbers.
// Reduces false-positive 12-digit numbers (phone numbers with country code,
// generic IDs, etc.) by ~99%.
func ValidateAadhaar(s string) bool {
	digits := keepDigits(s)
	if len(digits) != 12 {
		return false
	}
	c := 0
	for i, ch := range reverse(digits) {
		c = verhoeffD[c][verhoeffP[i%8][int(ch-'0')]]
	}
	return c == 0
}

// ValidateLuhn — credit card / IMEI validator. Accepts 13-19 digits.
func ValidateLuhn(s string) bool {
	digits := keepDigits(s)
	n := len(digits)
	if n < 13 || n > 19 {
		return false
	}
	sum := 0
	dbl := false
	for i := n - 1; i >= 0; i-- {
		d := int(digits[i] - '0')
		if dbl {
			d *= 2
			if d > 9 {
				d -= 9
			}
		}
		sum += d
		dbl = !dbl
	}
	return sum%10 == 0
}

// ValidatePAN — Indian PAN: AAAAA9999A where the 4th char is the entity code.
// (P=individual, F=firm, C=company, H=HUF, A=AOP, T=trust, B=BOI, L=local
// authority, J=artificial juridical person, G=government).
func ValidatePAN(s string) bool {
	s = strings.ToUpper(strings.TrimSpace(s))
	if len(s) != 10 {
		return false
	}
	for i := 0; i < 5; i++ {
		if !unicode.IsLetter(rune(s[i])) {
			return false
		}
	}
	for i := 5; i < 9; i++ {
		if !unicode.IsDigit(rune(s[i])) {
			return false
		}
	}
	if !unicode.IsLetter(rune(s[9])) {
		return false
	}
	if !strings.ContainsRune("PFCHATBLJG", rune(s[3])) {
		return false
	}
	return true
}

// ValidateSSN — US Social Security Number sanity check. Rejects the well-known
// invalid prefixes (000, 666, 9XX), 00 group, 0000 serial.
func ValidateSSN(s string) bool {
	parts := strings.Split(strings.TrimSpace(s), "-")
	if len(parts) != 3 || len(parts[0]) != 3 || len(parts[1]) != 2 || len(parts[2]) != 4 {
		return false
	}
	if parts[0] == "000" || parts[0] == "666" || parts[0][0] == '9' {
		return false
	}
	if parts[1] == "00" || parts[2] == "0000" {
		return false
	}
	return true
}

func keepDigits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func reverse(s string) string {
	r := []rune(s)
	for i, j := 0, len(r)-1; i < j; i, j = i+1, j-1 {
		r[i], r[j] = r[j], r[i]
	}
	return string(r)
}

// Verhoeff tables (RFC: dihedral group D5 multiplication / permutation).
var verhoeffD = [10][10]int{
	{0, 1, 2, 3, 4, 5, 6, 7, 8, 9},
	{1, 2, 3, 4, 0, 6, 7, 8, 9, 5},
	{2, 3, 4, 0, 1, 7, 8, 9, 5, 6},
	{3, 4, 0, 1, 2, 8, 9, 5, 6, 7},
	{4, 0, 1, 2, 3, 9, 5, 6, 7, 8},
	{5, 9, 8, 7, 6, 0, 4, 3, 2, 1},
	{6, 5, 9, 8, 7, 1, 0, 4, 3, 2},
	{7, 6, 5, 9, 8, 2, 1, 0, 4, 3},
	{8, 7, 6, 5, 9, 3, 2, 1, 0, 4},
	{9, 8, 7, 6, 5, 4, 3, 2, 1, 0},
}

var verhoeffP = [8][10]int{
	{0, 1, 2, 3, 4, 5, 6, 7, 8, 9},
	{1, 5, 7, 6, 2, 8, 3, 0, 9, 4},
	{5, 8, 0, 3, 7, 9, 6, 1, 4, 2},
	{8, 9, 1, 6, 0, 4, 3, 5, 2, 7},
	{9, 4, 5, 3, 1, 2, 6, 8, 7, 0},
	{4, 2, 8, 6, 5, 7, 3, 9, 0, 1},
	{2, 7, 9, 3, 8, 0, 6, 4, 1, 5},
	{7, 0, 4, 6, 9, 1, 3, 2, 5, 8},
}
