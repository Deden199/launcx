#!/bin/bash

# ========================================
# INA Payment CLI Tool
# ========================================
# Usage: ./ina-payment.sh [command] [options]
# Commands:
#   create <amount> <player_id>  - Create payment
#   check <order_id>              - Check payment status
#   history                       - Get payment history
#   test                          - Run test payment
# ========================================

set -e

# Configuration
API_BASE_URL="${API_BASE_URL:-http://localhost:5000}"
API_KEY="${API_KEY:-9be3380f-8189-4232-ba1f-78e21ce60948}"

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

# Make authenticated API request
api_request() {
    local method=$1
    local endpoint=$2
    local data=$3
    local timestamp=$(get_timestamp)

    local url="${API_BASE_URL}${endpoint}"

    if [ "$method" = "GET" ]; then
        curl -s -X GET "$url" \
            -H "Content-Type: application/json" \
            -H "x-api-key: ${API_KEY}" \
            -H "x-timestamp: ${timestamp}"
    else
        curl -s -X POST "$url" \
            -H "Content-Type: application/json" \
            -H "x-api-key: ${API_KEY}" \
            -H "x-timestamp: ${timestamp}" \
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

# Create payment
create_payment() {
    local amount=${1:-10000}
    local player_id=${2:-"player_$(date +%s)"}
    local merchant_name=${3:-"INA"}

    print_header "Creating Payment"
    print_info "Amount: Rp ${amount}"
    print_info "Player ID: ${player_id}"
    print_info "Merchant: ${merchant_name}"
    print_info "Timestamp: $(get_timestamp)"
    echo ""

    local payload=$(cat <<EOF
{
  "merchantName": "${merchant_name}",
  "price": ${amount},
  "playerId": "${player_id}",
  "flow": "embed",
  "paymentChannel": "qris"
}
EOF
)

    print_info "Sending request to: ${API_BASE_URL}/api/v1/payments"
    echo ""

    local response=$(api_request "POST" "/api/v1/payments" "$payload")

    # Check if response is empty
    if [ -z "$response" ]; then
        print_error "No response received from server"
        return 1
    fi

    # Check for error
    if echo "$response" | grep -q '"error"'; then
        print_error "Request failed!"
        echo ""
        print_json "$response"
        return 1
    fi

    print_success "Payment created successfully!"
    echo ""
    print_json "$response"

    # Extract order ID if available
    if command -v jq &> /dev/null; then
        local order_id=$(echo "$response" | jq -r '.orderId // .data.orderId // empty')
        if [ ! -z "$order_id" ]; then
            echo ""
            print_success "Order ID: ${order_id}"
            echo ""
            print_info "To check status, run:"
            echo -e "${YELLOW}  ./ina-payment.sh check ${order_id}${NC}"
        fi
    fi
}

# Check payment status
check_payment() {
    local order_id=$1

    if [ -z "$order_id" ]; then
        print_error "Order ID is required"
        echo "Usage: $0 check <order_id>"
        return 1
    fi

    print_header "Checking Payment Status"
    print_info "Order ID: ${order_id}"
    echo ""

    local response=$(api_request "GET" "/api/v1/transactions/${order_id}")

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

    # Extract status if available
    if command -v jq &> /dev/null; then
        local status=$(echo "$response" | jq -r '.status // .data.status // empty')
        local amount=$(echo "$response" | jq -r '.amount // .data.amount // empty')

        if [ ! -z "$status" ]; then
            echo ""
            case "$status" in
                "SUCCESS"|"PAID"|"COMPLETED")
                    print_success "Status: ${status}"
                    ;;
                "PENDING")
                    print_warning "Status: ${status}"
                    ;;
                "FAILED"|"EXPIRED")
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

# Get payment history
get_history() {
    local page=${1:-1}
    local limit=${2:-10}

    print_header "Payment History"
    print_info "Page: ${page}"
    print_info "Limit: ${limit}"
    echo ""

    local response=$(api_request "GET" "/api/v1/transactions?page=${page}&limit=${limit}")

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

# Run test payment
test_payment() {
    print_header "Running Test Payment"
    echo ""

    local test_amount=1000
    local test_player="test_$(date +%s)"

    print_info "Test Configuration:"
    print_info "  API URL: ${API_BASE_URL}"
    print_info "  API Key: ${API_KEY:0:20}..."
    print_info "  Amount: Rp ${test_amount}"
    print_info "  Player: ${test_player}"
    echo ""

    # Test timestamp generation
    local timestamp=$(get_timestamp)
    print_info "Generated Timestamp: ${timestamp}"
    echo ""

    # Create test payment
    print_info "Creating test payment..."
    echo ""
    create_payment "$test_amount" "$test_player" "INA"
}

# Show usage
show_usage() {
    cat << EOF
${CYAN}INA Payment CLI Tool${NC}

${YELLOW}Usage:${NC}
  $0 <command> [options]

${YELLOW}Commands:${NC}
  ${GREEN}create${NC} <amount> <player_id>     Create a new payment
  ${GREEN}check${NC} <order_id>                Check payment status
  ${GREEN}history${NC} [page] [limit]          Get payment history
  ${GREEN}test${NC}                            Run test payment

${YELLOW}Examples:${NC}
  # Create payment for 10,000 IDR
  $0 create 10000 player_123

  # Create payment with auto-generated player ID
  $0 create 50000

  # Check payment status
  $0 check order_1729335000000

  # Get payment history (page 1, 10 items)
  $0 history 1 10

  # Run test
  $0 test

${YELLOW}Environment Variables:${NC}
  ${BLUE}API_BASE_URL${NC}    API base URL (default: http://localhost:5000)
  ${BLUE}API_KEY${NC}         API key for authentication

${YELLOW}Configuration:${NC}
  Current API URL: ${BLUE}${API_BASE_URL}${NC}
  Current API Key: ${BLUE}${API_KEY:0:20}...${NC}

EOF
}

# Main script
main() {
    local command=${1:-help}

    case "$command" in
        create)
            create_payment "$2" "$3" "$4"
            ;;
        check)
            check_payment "$2"
            ;;
        history)
            get_history "$2" "$3"
            ;;
        test)
            test_payment
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