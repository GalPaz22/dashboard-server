# Site Config Endpoint Documentation

## Overview
New endpoint to retrieve the `siteConfig` object stored in user credentials.

## Endpoint
```
POST /site-config
```

## Authentication
Requires `X-API-Key` header with valid API key. The `dbName` is automatically retrieved from the API key.

## Request Body
Empty body (or empty JSON `{}`):
```json
{}
```

## Response

### Success (200)
Returns the `siteConfig` object from the user's credentials:
```json
{
  "siteName": "My Wine Store",
  "theme": "dark",
  "customSettings": {
    "key": "value"
  }
  // ... any other fields in your siteConfig
}
```

### Error Responses

#### 401 - Missing API Key
```json
{
  "error": "Missing X-API-Key"
}
```

#### 401 - Invalid API Key
```json
{
  "error": "Invalid API key"
}
```

#### 404 - User Credentials Not Found
```json
{
  "error": "User credentials not found"
}
```

#### 404 - Site Config Not Found
```json
{
  "error": "siteConfig not found"
}
```

#### 500 - Server Error
```json
{
  "error": "Internal server error"
}
```

## Example Usage

### JavaScript (Fetch)
```javascript
const response = await fetch('http://localhost:8080/site-config', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'your-api-key-here'
  },
  body: JSON.stringify({})
});

const siteConfig = await response.json();
console.log('Site Config:', siteConfig);
```

### cURL
```bash
curl -X POST http://localhost:8080/site-config \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key-here" \
  -d '{}'
```

## Database Structure

The endpoint reads from the `users` database:

```javascript
{
  "apiKey": "...",
  "dbName": "your-database-name",
  "credentials": {
    "siteConfig": {
      // Your site configuration object
      "siteName": "My Store",
      "theme": "dark",
      // ... any other fields
    },
    // ... other credential fields
  }
}
```

## Security Notes

1. ✅ API key is validated before access
2. ✅ dbName must match the user's assigned database
3. ✅ Only the `siteConfig` object is returned (no sensitive credentials exposed)
4. ✅ Endpoint handles its own authentication (bypasses global auth middleware)

## Logs

When the endpoint is called, you'll see:
```
[SITE-CONFIG] ✅ Retrieved config for dbName: your-database-name
```

In case of errors:
```
[SITE-CONFIG] Error: <error details>
```

