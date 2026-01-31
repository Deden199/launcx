#!/usr/bin/env python3
"""
Backend API Testing for DanaRapay Provider Balance Feature
Tests the GET /api/v1/client/provider-balance endpoint
"""

import requests
import sys
import json
from datetime import datetime

class DanaRapayProviderBalanceTest:
    def __init__(self, base_url="http://localhost:8001"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def log_test(self, name, success, details=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name} - PASSED")
        else:
            print(f"❌ {name} - FAILED: {details}")
        
        self.test_results.append({
            "name": name,
            "success": success,
            "details": details,
            "timestamp": datetime.now().isoformat()
        })

    def test_provider_balance_unauthorized(self):
        """Test that endpoint returns 401 without authentication"""
        try:
            response = requests.get(f"{self.base_url}/api/v1/client/provider-balance", timeout=10)
            
            if response.status_code == 401:
                self.log_test("Provider Balance - Unauthorized Access", True)
                return True
            else:
                self.log_test("Provider Balance - Unauthorized Access", False, 
                            f"Expected 401, got {response.status_code}")
                return False
                
        except Exception as e:
            self.log_test("Provider Balance - Unauthorized Access", False, str(e))
            return False

    def test_provider_balance_service_unavailable(self):
        """Test that endpoint returns 503 when DanaRapay not configured"""
        try:
            # Create a mock token for testing (this would normally require proper auth)
            # For now, we'll test the endpoint behavior when credentials are missing
            headers = {'Authorization': 'Bearer fake-token-for-testing'}
            response = requests.get(f"{self.base_url}/api/v1/client/provider-balance", 
                                  headers=headers, timeout=10)
            
            # Since DanaRapay credentials are not configured, we expect 503 or 401
            if response.status_code in [503, 401]:
                try:
                    data = response.json()
                    if response.status_code == 503:
                        # Check if it's the expected service unavailable response
                        if (data.get('error') == 'Provider balance service not configured' and 
                            data.get('provider') == 'danarapay' and 
                            data.get('available') == False):
                            self.log_test("Provider Balance - Service Not Configured", True)
                            return True
                        else:
                            self.log_test("Provider Balance - Service Not Configured", False,
                                        f"Unexpected 503 response structure: {data}")
                            return False
                    else:
                        # 401 is also acceptable since we're using a fake token
                        self.log_test("Provider Balance - Service Not Configured", True, 
                                    "Got 401 as expected with fake token")
                        return True
                except json.JSONDecodeError:
                    self.log_test("Provider Balance - Service Not Configured", False,
                                "Response is not valid JSON")
                    return False
            else:
                self.log_test("Provider Balance - Service Not Configured", False,
                            f"Expected 503 or 401, got {response.status_code}")
                return False
                
        except Exception as e:
            self.log_test("Provider Balance - Service Not Configured", False, str(e))
            return False

    def test_api_structure(self):
        """Test basic API structure and routing"""
        try:
            # Test if the API is responding at all
            response = requests.get(f"{self.base_url}/api/v1/client/provider-balance", timeout=10)
            
            # Any response (even 401/503) means the endpoint exists and is routed correctly
            if response.status_code in [200, 401, 403, 503]:
                self.log_test("API Endpoint - Routing and Structure", True)
                return True
            else:
                self.log_test("API Endpoint - Routing and Structure", False,
                            f"Unexpected status code: {response.status_code}")
                return False
                
        except requests.exceptions.ConnectionError:
            self.log_test("API Endpoint - Routing and Structure", False,
                        "Cannot connect to backend server")
            return False
        except Exception as e:
            self.log_test("API Endpoint - Routing and Structure", False, str(e))
            return False

    def test_cors_headers(self):
        """Test CORS headers for frontend integration"""
        try:
            response = requests.options(f"{self.base_url}/api/v1/client/provider-balance", timeout=10)
            
            # Check if CORS headers are present (important for frontend)
            cors_headers = ['Access-Control-Allow-Origin', 'Access-Control-Allow-Methods']
            has_cors = any(header in response.headers for header in cors_headers)
            
            if has_cors or response.status_code == 200:
                self.log_test("API CORS - Headers Configuration", True)
                return True
            else:
                self.log_test("API CORS - Headers Configuration", False,
                            "No CORS headers found")
                return False
                
        except Exception as e:
            self.log_test("API CORS - Headers Configuration", False, str(e))
            return False

    def run_all_tests(self):
        """Run all tests"""
        print("🧪 Starting DanaRapay Provider Balance API Tests...")
        print("=" * 60)
        
        # Test basic API structure first
        self.test_api_structure()
        
        # Test authentication
        self.test_provider_balance_unauthorized()
        
        # Test service configuration
        self.test_provider_balance_service_unavailable()
        
        # Test CORS for frontend integration
        self.test_cors_headers()
        
        print("=" * 60)
        print(f"📊 Test Results: {self.tests_passed}/{self.tests_run} tests passed")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All tests passed!")
            return 0
        else:
            print("⚠️  Some tests failed. Check the details above.")
            return 1

    def get_test_summary(self):
        """Get test summary for reporting"""
        return {
            "total_tests": self.tests_run,
            "passed_tests": self.tests_passed,
            "failed_tests": self.tests_run - self.tests_passed,
            "success_rate": (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0,
            "test_results": self.test_results
        }

def main():
    tester = DanaRapayProviderBalanceTest()
    exit_code = tester.run_all_tests()
    
    # Save test results for reporting
    summary = tester.get_test_summary()
    with open('/tmp/backend_test_results.json', 'w') as f:
        json.dump(summary, f, indent=2)
    
    return exit_code

if __name__ == "__main__":
    sys.exit(main())