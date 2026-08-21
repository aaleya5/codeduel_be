# API Endpoints - LeetCode Session Management

## Base URL

```
http://localhost:3000/api/leetcode
```

All endpoints require authentication (JWT Bearer token).

---

## 1. Store LeetCode Session

**Endpoint:** `POST /api/leetcode/session`

**Description:** Store encrypted LeetCode session cookie for the authenticated user.

**Headers:**

```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

**Request Body:**

```json
{
  "cookie": "LEETCODE_SESSION=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "csrfToken": "abc123xyz",
  "expiresAt": "2026-02-06T00:00:00.000Z"
}
```

**Required Fields:**

- `cookie` (string) - LEETCODE_SESSION cookie value
- `csrfToken` (string, optional) - CSRF token from LeetCode
- `expiresAt` (ISO date string, optional) - Session expiration date

**Response (Success):**

```json
{
  "success": true,
  "message": "LeetCode session stored successfully",
  "data": {
    "id": "uuid",
    "userId": "user-uuid",
    "isActive": true,
    "expiresAt": "2026-02-06T00:00:00.000Z"
  }
}
```

**Response (Validation Error):**

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "msg": "LeetCode session cookie is required",
      "param": "cookie",
      "location": "body"
    }
  ]
}
```

**Response (Invalid Session):**

```json
{
  "success": false,
  "message": "Invalid LeetCode session. Please check your credentials."
}
```

---

## 2. Get Session Status

**Endpoint:** `GET /api/leetcode/session`

**Description:** Check if user has an active LeetCode session and if it's still valid.

**Headers:**

```
Authorization: Bearer <JWT_TOKEN>
```

**Response (Has Valid Session):**

```json
{
  "success": true,
  "data": {
    "hasSession": true,
    "isValid": true,
    "message": "Session is active and valid"
  }
}
```

**Response (Has Expired Session):**

```json
{
  "success": true,
  "data": {
    "hasSession": true,
    "isValid": false,
    "message": "Session exists but may be expired"
  }
}
```

**Response (No Session):**

```json
{
  "success": true,
  "data": {
    "hasSession": false,
    "message": "No active session found"
  }
}
```

---

## 3. Invalidate Session

**Endpoint:** `DELETE /api/leetcode/session`

**Description:** Remove/invalidate the user's LeetCode session.

**Headers:**

```
Authorization: Bearer <JWT_TOKEN>
```

**Response:**

```json
{
  "success": true,
  "message": "LeetCode session invalidated successfully"
}
```

---

## 4. Get LeetCode Profile

**Endpoint:** `GET /api/leetcode/profile/:username`

**Description:** Fetch LeetCode profile statistics for a user.

**Headers:**

```
Authorization: Bearer <JWT_TOKEN>
```

**URL Parameters:**

- `username` (string) - LeetCode username

**Example:**

```
GET /api/leetcode/profile/john_doe
```

**Response:**

```json
{
  "success": true,
  "data": {
    "username": "john_doe",
    "streak": 15,
    "totalActiveDays": 120,
    "activeYears": [2024, 2025, 2026],
    "submissionCalendar": {
      "1735689600": 3,
      "1735776000": 2,
      "1735862400": 1
    }
  }
}
```

**Response (User Not Found):**

```json
{
  "success": false,
  "message": "User not found"
}
```

---

## 5. Test Connection

**Endpoint:** `GET /api/leetcode/test/:username`

**Description:** Test LeetCode API connection by fetching recent submissions.

**Headers:**

```
Authorization: Bearer <JWT_TOKEN>
```

**URL Parameters:**

- `username` (string) - LeetCode username to test

**Example:**

```
GET /api/leetcode/test/john_doe
```

**Response:**

```json
{
  "success": true,
  "message": "Connection test successful",
  "data": {
    "username": "john_doe",
    "hasSession": true,
    "submissionsFound": 3,
    "submissions": [
      {
        "id": "12345",
        "title": "Two Sum",
        "titleSlug": "two-sum",
        "timestamp": "2026-01-05T10:30:00.000Z",
        "status": "Accepted",
        "language": "python3",
        "difficulty": "Easy",
        "questionId": "1",
        "isPaidOnly": false,
        "topicTags": ["Array", "Hash Table"]
      }
    ]
  }
}
```

---

## 6. Get Problem Metadata

**Endpoint:** `GET /api/leetcode/problem/:titleSlug`

**Description:** Fetch metadata for a specific LeetCode problem.

**Headers:**

```
Authorization: Bearer <JWT_TOKEN>
```

**URL Parameters:**

- `titleSlug` (string) - Problem title slug (e.g., "two-sum")

**Example:**

```
GET /api/leetcode/problem/two-sum
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "titleSlug": "two-sum",
    "questionId": "1",
    "title": "Two Sum",
    "difficulty": "Easy",
    "acRate": 49.2,
    "likes": 45678,
    "dislikes": 1234,
    "isPaidOnly": false,
    "topicTags": ["Array", "Hash Table"],
    "lastFetchedAt": "2026-01-06T00:00:00.000Z",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-06T00:00:00.000Z"
  }
}
```

**Response (Problem Not Found):**

```json
{
  "success": false,
  "message": "Problem not found: invalid-slug"
}
```

---

## How to Get Your LeetCode Session Cookie

### Method 1: Browser DevTools

1. Log in to [leetcode.com](https://leetcode.com/)
2. Open DevTools (F12)
3. Go to **Application** tab (Chrome) or **Storage** tab (Firefox)
4. Navigate to **Cookies** → `https://leetcode.com`
5. Find `LEETCODE_SESSION`
6. Copy the **Value**
7. Also copy `csrftoken` if available

### Method 2: Browser Extension

Use a cookie manager extension like "EditThisCookie" to export cookies.

### Method 3: Network Tab

1. Log in to LeetCode
2. Open DevTools → **Network** tab
3. Make any request to LeetCode
4. Look at **Request Headers**
5. Copy the `Cookie` header value

**Example Cookie:**

```
LEETCODE_SESSION=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfYXV0aF91c2VyX2lkIjoiMTIzNDU2IiwiX2F1dGhfdXNlcl9iYWNrZW5kIjoiZGphbmdvLmNvbnRyaWIuYXV0aC5iYWNrZW5kcy5Nb2RlbEJhY2tlbmQiLCJfYXV0aF91c2VyX2hhc2giOiJhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5eiJ9.1234567890abcdefghijklmnopqrstuvwxyz
```

---

## Security Notes

### ⚠️ Important Security Practices

1. **Never share your session cookie publicly**

   - Treat it like a password
   - It provides full access to your LeetCode account

2. **Session encryption**

   - All sessions are encrypted using AES-256-GCM
   - Encryption key stored in `.env` file
   - Never returned to frontend in decrypted form

3. **Session expiration**

   - LeetCode sessions typically expire after 30 days
   - Set `expiresAt` when storing to track expiration
   - Regularly check session status

4. **HTTPS only**

   - Always use HTTPS in production
   - Prevents session interception

5. **Rate limiting**
   - LeetCode may rate limit API requests
   - Backend caches problem metadata (7-day cache)
   - Reduces API calls by ~95%

---

## Error Codes

| Code | Description           | Solution                    |
| ---- | --------------------- | --------------------------- |
| 400  | Validation failed     | Check request body format   |
| 401  | Unauthorized          | Provide valid JWT token     |
| 403  | Forbidden             | Session expired or invalid  |
| 404  | Resource not found    | Check username/problem slug |
| 429  | Rate limit exceeded   | Wait before retrying        |
| 500  | Internal server error | Check server logs           |

---

## Common Use Cases

### Use Case 1: First-Time Setup

1. User logs into LeetCode
2. User copies `LEETCODE_SESSION` cookie
3. User stores session:
   ```bash
   POST /api/leetcode/session
   {
     "cookie": "LEETCODE_SESSION=...",
     "csrfToken": "abc123",
     "expiresAt": "2026-02-06T00:00:00.000Z"
   }
   ```
4. Backend validates and stores encrypted session
5. Daily evaluations now use this session

### Use Case 2: Session Refresh

1. User notices daily evaluations failing
2. Check session status:
   ```bash
   GET /api/leetcode/session
   ```
3. If `isValid: false`, update session:
   ```bash
   POST /api/leetcode/session
   {
     "cookie": "new_session_here"
   }
   ```

### Use Case 3: Testing Integration

1. Store session (if needed)
2. Test connection:
   ```bash
   GET /api/leetcode/test/your_username
   ```
3. Verify `submissionsFound > 0`

### Use Case 4: Debugging Problem Difficulty

1. Fetch problem metadata:
   ```bash
   GET /api/leetcode/problem/two-sum
   ```
2. Verify `difficulty` field is correct
3. Check `lastFetchedAt` to see cache age

---

## Testing with cURL

### Store Session

```bash
curl -X POST http://localhost:3000/api/leetcode/session \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cookie": "LEETCODE_SESSION=your_session_here",
    "csrfToken": "your_csrf_token"
  }'
```

### Check Session Status

```bash
curl -X GET http://localhost:3000/api/leetcode/session \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Test Connection

```bash
curl -X GET http://localhost:3000/api/leetcode/test/your_username \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Get Problem Metadata

```bash
curl -X GET http://localhost:3000/api/leetcode/problem/two-sum \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

---

## Frontend Integration Example

### React/Vue/Angular

```javascript
// Store session
const storeSession = async (cookie, csrfToken) => {
  try {
    const response = await fetch("http://localhost:3000/api/leetcode/session", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${localStorage.getItem("token")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cookie, csrfToken }),
    });

    const data = await response.json();

    if (data.success) {
      alert("Session stored successfully!");
    } else {
      alert("Failed to store session: " + data.message);
    }
  } catch (error) {
    console.error("Error storing session:", error);
  }
};

// Check session status
const checkSession = async () => {
  try {
    const response = await fetch("http://localhost:3000/api/leetcode/session", {
      headers: {
        Authorization: `Bearer ${localStorage.getItem("token")}`,
      },
    });

    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error("Error checking session:", error);
  }
};

// Test connection
const testConnection = async (username) => {
  try {
    const response = await fetch(
      `http://localhost:3000/api/leetcode/test/${username}`,
      {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token")}`,
        },
      }
    );

    const data = await response.json();
    console.log(`Found ${data.data.submissionsFound} submissions`);
    return data.data;
  } catch (error) {
    console.error("Error testing connection:", error);
  }
};
```

---

## Troubleshooting

### Problem: "Invalid LeetCode session"

**Possible Causes:**

- Cookie is expired
- Cookie is malformed
- CSRF token is incorrect

**Solution:**

1. Log out and log back into LeetCode
2. Copy fresh cookie
3. Try storing again

---

### Problem: "Authentication failed"

**Possible Causes:**

- JWT token is expired
- JWT token is missing

**Solution:**

1. Re-authenticate with `/api/auth/login`
2. Get new JWT token
3. Include token in `Authorization` header

---

### Problem: "Rate limit exceeded"

**Possible Causes:**

- Too many API calls to LeetCode
- Multiple users evaluated simultaneously

**Solution:**

1. Wait 10-15 minutes
2. Ensure caching is working
3. Check `problem_metadata` table has entries

---

## Summary

✅ **All LeetCode session management endpoints implemented**  
✅ **Secure encryption with AES-256-GCM**  
✅ **Session validation before storage**  
✅ **Easy testing with `/test` endpoint**  
✅ **Problem metadata caching**  
✅ **Production-ready error handling**

🚀 **Ready for integration!**
