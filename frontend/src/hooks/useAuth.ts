// frontend/src/hooks/useAuth.ts
import { useEffect } from 'react'
import { useState } from 'react'
import { useRouter } from 'next/router'

/**
 * Hook to guard routes that require authentication.
 * Redirects to /login if no token is found in localStorage.
 */
export function useRequireAuth() {
  const router = useRouter()
  const [isAuthorized, setIsAuthorized] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      setIsAuthorized(false)
      router.replace('/login')
      return
    }
    setIsAuthorized(true)
  }, [router])

  return isAuthorized
}
