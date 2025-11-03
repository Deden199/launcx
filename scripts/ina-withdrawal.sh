#!/bin/bash

# ========================================
# INA Withdrawal CLI Tool
# ========================================
# Usage: ./ina-withdrawal.sh [command] [options]
# Commands:
#   validate <account> <bank> <amount>  - Validate bank account
#   create <account> <bank> <amount>    - Create withdrawal
#   check <withdrawal_id>               - Check withdrawal status
#   history                             - Get withdrawal history
#   banks                               - List supported banks
#   test                                - Run test withdrawal
# ========================================

set -e

# Configuration
API_BASE_URL="${API_BASE_URL:-http://localhost:5000}"
API_KEY="${API_KEY:-9be3380f-8189-4232-ba1f-78e21ce60948}"
AUTH_TOKEN="${AUTH_TOKEN:-}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Helper functions
print_header() {
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}$1${NC}"
    echo -e "${CYAN}========================================${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

# Generate timestamp
get_timestamp() {
    echo "$(date +%s)000"
}

# Make authenticated API request (for client endpoints)
api_request_client() {
    local method=$1
    local endpoint=$2
    local data=$3

    if [ -z "$AUTH_TOKEN" ]; then
        print_error "AUTH_TOKEN not set. Please login first or set AUTH_TOKEN environment variable."
        return 1
    fi

    local url="${API_BASE_URL}${endpoint}"

    if [ "$method" = "GET" ]; then
        curl -s -X GET "$url" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer ${AUTH_TOKEN}"
    else
        curl -s -X POST "$url" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer ${AUTH_TOKEN}" \
            -d "$data"
    fi
}

# Pretty print JSON
print_json() {
    if command -v jq &> /dev/null; then
        echo "$1" | jq '.'
    else
        echo "$1" | python -m json.tool 2>/dev/null || echo "$1"
    fi
}

# Bank code mapping
get_bank_code() {
    local bank_input=$(echo "$1" | tr '[:upper:]' '[:lower:]')

    case "$bank_input" in
        bca|014)
            echo "014"
            ;;
        mandiri|008)
            echo "008"
            ;;
        bni|009)
            echo "009"
            ;;
        bri|002)
            echo "002"
            ;;
        permata|013)
            echo "013"
            ;;
        cimb|022)
            echo "022"
            ;;
        *)
            echo "$bank_input"
            ;;
    esac
}

# Get bank name
get_bank_name() {
    case "$1" in
        014)
            echo "Bank Central Asia"
            ;;
        008)
            echo "Bank Mandiri"
            ;;
        009)
            echo "Bank Negara Indonesia"
            ;;
        002)
            echo "Bank Rakyat Indonesia"
            ;;
        013)
            echo "Bank Permata"
            ;;
        022)
            echo "Bank CIMB Niaga"
            ;;
        *)
            echo "Unknown Bank"
            ;;
    esac
}

# List supported banks
list_banks() {
    print_header "Supported Banks"
    echo ""
    echo -e "${CYAN}Code${NC}  ${CYAN}Bank Name${NC}"
    echo "────  ────────────────────────────"
    echo -e "${GREEN}014${NC}   Bank Central Asia (BCA)"
    echo -e "${GREEN}008${NC}   Bank Mandiri"
    echo -e "${GREEN}009${NC}   Bank Negara Indonesia (BNI)"
    echo -e "${GREEN}002${NC}   Bank Rakyat Indonesia (BRI)"
    echo -e "${GREEN}013${NC}   Bank Permata"
    echo -e "${GREEN}022${NC}   Bank CIMB Niaga"
    echo ""
    print_info "You can use either bank code or name (case-insensitive)"
    echo -e "  Example: ${YELLOW}bca${NC} or ${YELLOW}014${NC}"
}

# Validate bank account
validate_account() {
    local account_number=$1
    local bank=$2
    local amount=${3:-50000}

    if [ -z "$account_number" ] || [ -z "$bank" ]; then
        print_error "Account number and bank are required"
        echo "Usage: $0 validate <account_number> <bank_code> [amount]"
        return 1
    fi

    local bank_code=$(get_bank_code "$bank")
    local bank_name=$(get_bank_name "$bank_code")

    print_header "Validating Bank Account"
    print_info "Account: ${account_number}"
    print_info "Bank: ${bank_name} (${bank_code})"
    print_info "Amount: Rp ${amount}"
    echo ""

    local payload=$(cat <<EOF
{
  "account_number": "${account_number}",
  "bank_code": "${bank_code}",
  "sourceProvider": "ing1",
  "amount": ${amount}
}
EOF
)

    print_info "Sending validation request..."
    echo ""

    local response=$(api_request_client "POST" "/api/v1/client/withdrawals/validate" "$payload")

    if [ -z "$response" ]; then
        print_error "No response received from server"
        return 1
    fi

    if echo "$response" | grep -q '"error"'; then
        print_error "Validation failed!"
        echo ""
        print_json "$response"
        return 1
    fi

    print_success "Account validated successfully!"
    echo ""
    print_json "$response"

    # Extract account info
    if command -v jq &> /dev/null; then
        local account_name=$(echo "$response" | jq -r '.data.accountName // .accountName // empty')
        local fee=$(echo "$response" | jq -r '.data.fee // .fee // empty')
        local total=$(echo "$response" | jq -r '.data.totalAmount // .totalAmount // empty')
        local reference=$(echo "$response" | jq -r '.data.reference // .reference // empty')

        if [ ! -z "$account_name" ]; then
            echo ""
            print_success "Account Name: ${account_name}"
            if [ ! -z "$fee" ]; then
                print_info "Transfer Fee: Rp ${fee}"
            fi
            if [ ! -z "$total" ]; then
                print_info "Total Amount: Rp ${total}"
            fi
            if [ ! -z "$reference" ]; then
                echo ""
                print_warning "Reference ID: ${reference}"
                print_info "Use this reference to create withdrawal"
            fi
        fi
    fi
}

# Create withdrawal
create_withdrawal() {
    local account_number=$1
    local bank=$2
    local amount=${3:-50000}
    local otp=${4:-"123456"}

    if [ -z "$account_number" ] || [ -z "$bank" ]; then
        print_error "Account number and bank are required"
        echo "Usage: $0 create <account_number> <bank_code> <amount> [otp]"
        return 1
    fi

    local bank_code=$(get_bank_code "$bank")
    local bank_name=$(get_bank_name "$bank_code")

    print_header "Creating Withdrawal"
    print_info "Account: ${account_number}"
    print_info "Bank: ${bank_name} (${bank_code})"
    print_info "Amount: Rp ${amount}"
    echo ""

    # First validate
    print_info "Step 1: Validating account..."
    echo ""

    local validate_payload=$(cat <<EOF
{
  "account_number": "${account_number}",
  "bank_code": "${bank_code}",
  "sourceProvider": "ing1",
  "amount": ${amount}
}
EOF
)

    local validate_response=$(api_request_client "POST" "/api/v1/client/withdrawals/validate" "$validate_payload")

    if echo "$validate_response" | grep -q '"error"'; then
        print_error "Account validation failed!"
        print_json "$validate_response"
        return 1
    fi

    print_success "Account validated!"

    # Extract validated data
    local account_name=""
    local sub_merchant_id=""

    if command -v jq &> /dev/null; then
        account_name=$(echo "$validate_response" | jq -r '.data.accountName // .accountName // empty')
        # You may need to get subMerchantId from your system
        print_info "Account Name: ${account_name}"
    fi

    echo ""
    print_info "Step 2: Creating withdrawal request..."
    echo ""

    # Create withdrawal
    local withdrawal_payload=$(cat <<EOF
{
  "sourceProvider": "ing1",
  "account_number": "${account_number}",
  "bank_code": "${bank_code}",
  "amount": ${amount},
  "account_name": "${account_name}",
  "bank_name": "${bank_name}",
  "otp": "${otp}"
}
EOF
)

    local response=$(api_request_client "POST" "/api/v1/client/withdrawals" "$withdrawal_payload")

    if [ -z "$response" ]; then
        print_error "No response received from server"
        return 1
    fi

    if echo "$response" | grep -q '"error"'; then
        print_error "Withdrawal creation failed!"
        echo ""
        print_json "$response"
        return 1
    fi

    print_success "Withdrawal created successfully!"
    echo ""
    print_json "$response"

    # Extract withdrawal ID
    if command -v jq &> /dev/null; then
        local withdrawal_id=$(echo "$response" | jq -r '.data.withdrawalId // .data.refId // .refId // empty')
        if [ ! -z "$withdrawal_id" ]; then
            echo ""
            print_success "Withdrawal ID: ${withdrawal_id}"
            echo ""
            print_info "To check status, run:"
            echo -e "${YELLOW}  ./ina-withdrawal.sh check ${withdrawal_id}${NC}"
        fi
    fi
}

# Check withdrawal status
check_withdrawal() {
    local withdrawal_id=$1

    if [ -z "$withdrawal_id" ]; then
        print_error "Withdrawal ID is required"
        echo "Usage: $0 check <withdrawal_id>"
        return 1
    fi

    print_header "Checking Withdrawal Status"
    print_info "Withdrawal ID: ${withdrawal_id}"
    echo ""

    local response=$(api_request_client "GET" "/api/v1/client/withdrawals/${withdrawal_id}")

    if [ -z "$response" ]; then
        print_error "No response received from server"
        return 1
    fi

    if echo "$response" | grep -q '"error"'; then
        print_error "Request failed!"
        echo ""
        print_json "$response"
        return 1
    fi

    print_success "Status retrieved successfully!"
    echo ""
    print_json "$response"

    # Extract status
    if command -v jq &> /dev/null; then
        local status=$(echo "$response" | jq -r '.status // .data.status // empty')
        local amount=$(echo "$response" | jq -r '.amount // .data.amount // empty')

        if [ ! -z "$status" ]; then
            echo ""
            case "$status" in
                "COMPLETED"|"SUCCESS")
                    print_success "Status: ${status}"
                    ;;
                "PENDING")
                    print_warning "Status: ${status}"
                    ;;
                "FAILED"|"REJECTED")
                    print_error "Status: ${status}"
                    ;;
                *)
                    print_info "Status: ${status}"
                    ;;
            esac

            if [ ! -z "$amount" ]; then
                print_info "Amount: Rp ${amount}"
            fi
        fi
    fi
}

# Get withdrawal history
get_history() {
    local page=${1:-1}
    local limit=${2:-10}

    print_header "Withdrawal History"
    print_info "Page: ${page}"
    print_info "Limit: ${limit}"
    echo ""

    local response=$(api_request_client "GET" "/api/v1/client/withdrawals?page=${page}&limit=${limit}")

    if [ -z "$response" ]; then
        print_error "No response received from server"
        return 1
    fi

    if echo "$response" | grep -q '"error"'; then
        print_error "Request failed!"
        echo ""
        print_json "$response"
        return 1
    fi

    print_success "History retrieved successfully!"
    echo ""
    print_json "$response"
}

# Run test withdrawal
test_withdrawal() {
    print_header "Running Test Withdrawal"
    echo ""

    print_warning "This is a TEST - using test account number"
    echo ""

    local test_account="1234567890"
    local test_bank="bca"
    local test_amount=50000

    print_info "Test Configuration:"
    print_info "  API URL: ${API_BASE_URL}"
    print_info "  Account: ${test_account}"
    print_info "  Bank: ${test_bank}"
    print_info "  Amount: Rp ${test_amount}"
    echo ""

    if [ -z "$AUTH_TOKEN" ]; then
        print_error "AUTH_TOKEN not set!"
        echo ""
        print_info "Please set AUTH_TOKEN environment variable first:"
        echo -e "${YELLOW}  export AUTH_TOKEN='your_jwt_token_here'${NC}"
        return 1
    fi

    print_info "Step 1: Validating test account..."
    echo ""
    validate_account "$test_account" "$test_bank" "$test_amount"
}

# Show usage
show_usage() {
    cat << EOF
${CYAN}INA Withdrawal CLI Tool${NC}

${YELLOW}Usage:${NC}
  $0 <command> [options]

${YELLOW}Commands:${NC}
  ${GREEN}validate${NC} <account> <bank> <amount>   Validate bank account
  ${GREEN}create${NC} <account> <bank> <amount>     Create withdrawal
  ${GREEN}check${NC} <withdrawal_id>                Check withdrawal status
  ${GREEN}history${NC} [page] [limit]               Get withdrawal history
  ${GREEN}banks${NC}                                List supported banks
  ${GREEN}test${NC}                                 Run test withdrawal

${YELLOW}Examples:${NC}
  # List supported banks
  $0 banks

  # Validate account
  $0 validate 1234567890 bca 50000

  # Create withdrawal to BCA
  $0 create 1234567890 014 100000

  # Check withdrawal status
  $0 check wd-1729335200000

  # Get withdrawal history
  $0 history 1 10

  # Run test
  $0 test

${YELLOW}Environment Variables:${NC}
  ${BLUE}API_BASE_URL${NC}    API base URL (default: http://localhost:5000)
  ${BLUE}AUTH_TOKEN${NC}      JWT token for authentication (required)

${YELLOW}Configuration:${NC}
  Current API URL: ${BLUE}${API_BASE_URL}${NC}
  Auth Token Set: ${BLUE}$([ -z "$AUTH_TOKEN" ] && echo "No" || echo "Yes")${NC}

${YELLOW}Note:${NC}
  Withdrawal endpoints require authentication with JWT token.
  Set AUTH_TOKEN environment variable before using withdrawal commands.

EOF
}

# Main script
main() {
    local command=${1:-help}

    case "$command" in
        validate)
            validate_account "$2" "$3" "$4"
            ;;
        create)
            create_withdrawal "$2" "$3" "$4" "$5"
            ;;
        check)
            check_withdrawal "$2"
            ;;
        history)
            get_history "$2" "$3"
            ;;
        banks)
            list_banks
            ;;
        test)
            test_withdrawal
            ;;
        help|--help|-h)
            show_usage
            ;;
        *)
            print_error "Unknown command: $command"
            echo ""
            show_usage
            exit 1
            ;;
    esac
}

# Run main
main "$@"