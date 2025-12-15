# Multi-Industry Filter Extraction System

## Overview

The dashboard server now supports **multi-industry filter extraction** through customizable AI prompts. This allows you to use the same search infrastructure for different e-commerce verticals (wine, fashion, electronics, furniture, etc.) by simply configuring industry-specific domain knowledge.

## How It Works

### Default Behavior (Alcohol & Beverages)

By default, the system is optimized for the **wine and alcohol industry** with built-in domain knowledge about:
- Wine brands and their characteristics (e.g., "Alamos" → Malbec, Mendoza)
- Grape varieties (Malbec, Cabernet Sauvignon, Chardonnay, etc.)
- Wine regions (Bordeaux, Burgundy, Tuscany, Mendoza, Napa Valley, etc.)
- Spirits brands and types (Whisky, Vodka, Gin, Rum, Tequila, etc.)
- Wine characteristics and styles

This default prompt is used when **no custom `classifyPrompt` is configured** in your user document.

### Custom Industry Prompts

To customize the filter extraction for your specific industry, add a `classifyPrompt` field to your user document in MongoDB. The system will use your custom prompt instead of the default alcohol/beverages prompt.

## Configuration

### Setting a Custom Prompt

Update your user document in the `users` collection:

```javascript
db.users.updateOne(
  { apiKey: "your-api-key" },
  {
    $set: {
      classifyPrompt: "You are an expert at extracting structured data from e-commerce search queries for online fashion stores. You have knowledge of: fashion brands, clothing types, materials (cotton, silk, wool, polyester), styles (casual, formal, sporty), seasons, occasions, and color patterns."
    }
  }
)
```

### Reverting to Default (Alcohol/Beverages)

Remove the custom prompt to use the default:

```javascript
db.users.updateOne(
  { apiKey: "your-api-key" },
  { $unset: { classifyPrompt: "" } }
)
```

## Example Industry Prompts

### Fashion E-Commerce

```text
You are an expert at extracting structured data from e-commerce search queries for online fashion stores. You have knowledge of:
- Fashion brands (Zara, H&M, Gucci, Prada, Nike, Adidas, etc.)
- Clothing types (dresses, shirts, pants, jackets, shoes, accessories)
- Materials (cotton, silk, wool, polyester, leather, denim)
- Styles (casual, formal, sporty, vintage, bohemian, minimalist)
- Seasons (spring/summer, fall/winter)
- Occasions (work, party, wedding, gym, beach)
- Sizes and fits (slim fit, regular, oversized)
- Color patterns (solid, striped, floral, geometric)

When users mention fashion brands, USE YOUR KNOWLEDGE to extract relevant characteristics (style, typical price range, target demographic) if they exist in the provided soft categories list.
```

### Electronics Store

```text
You are an expert at extracting structured data from e-commerce search queries for electronics stores. You have knowledge of:
- Device brands (Apple, Samsung, Sony, LG, HP, Dell, Lenovo, etc.)
- Product categories (smartphones, laptops, tablets, TVs, cameras, audio)
- Specifications (RAM, storage, screen size, resolution, processor)
- Technology standards (5G, WiFi 6, Bluetooth, USB-C, HDMI)
- Operating systems (iOS, Android, Windows, macOS, Linux)
- Use cases (gaming, productivity, content creation, entertainment)
- Connectivity features (wireless, wired, NFC, GPS)

When users mention device brands or models, USE YOUR KNOWLEDGE to extract relevant specifications and features if they exist in the provided soft categories list.
```

### Furniture Store

```text
You are an expert at extracting structured data from e-commerce search queries for furniture stores. You have knowledge of:
- Furniture types (sofas, beds, tables, chairs, cabinets, shelves)
- Styles (modern, contemporary, traditional, rustic, industrial, Scandinavian)
- Materials (wood, metal, glass, fabric, leather, plastic)
- Rooms (living room, bedroom, dining room, office, kitchen, bathroom)
- Brands and designers (IKEA, Herman Miller, West Elm, etc.)
- Colors and finishes (oak, walnut, white, black, natural)
- Sizes and dimensions (small, medium, large, king, queen)

When users mention furniture brands or styles, USE YOUR KNOWLEDGE to extract relevant characteristics (material, typical style, room type) if they exist in the provided soft categories list.
```

### Cosmetics & Beauty

```text
You are an expert at extracting structured data from e-commerce search queries for cosmetics and beauty stores. You have knowledge of:
- Product types (lipstick, foundation, mascara, serum, moisturizer, shampoo)
- Brands (MAC, L'Oréal, Estée Lauder, Clinique, The Ordinary, etc.)
- Skin types (dry, oily, combination, sensitive, normal)
- Concerns (anti-aging, acne, hydration, brightening, sun protection)
- Ingredients (hyaluronic acid, retinol, vitamin C, niacinamide, SPF)
- Finishes (matte, glossy, dewy, natural)
- Shades and colors (nude, red, pink, berry, coral)

When users mention beauty brands or products, USE YOUR KNOWLEDGE to extract relevant characteristics (skin type suitability, key ingredients, use case) if they exist in the provided soft categories list.
```

## Technical Implementation

### Code Structure

1. **Default Prompt** (`server.js:81-90`):
   ```javascript
   const DEFAULT_CLASSIFY_PROMPT = `You are an expert at extracting structured data...`;
   ```

2. **User Configuration** (`server.js:536`):
   ```javascript
   classifyPrompt: userDoc.classifyPrompt || null
   ```

3. **Filter Extraction** (`server.js:2140-2154`):
   ```javascript
   async function extractFiltersFromQueryEnhanced(
     query, categories, types, softCategories,
     example, context, classifyPrompt = null
   ) {
     // Use custom industry prompt if provided, otherwise use default
     const industryKnowledge = classifyPrompt || DEFAULT_CLASSIFY_PROMPT;

     const systemInstruction = `${industryKnowledge} The user's context is: ${context}.
     // ... rest of the instruction
   }
   ```

### Cache Behavior

The caching system includes the `classifyPrompt` in the cache key, ensuring:
- Different industries get separate cache entries
- Switching between prompts doesn't return stale results
- Performance is maintained through Redis caching

### Fallback System

If the AI circuit breaker opens (due to API failures), the system falls back to rule-based filter extraction regardless of the custom prompt. This ensures high availability even when the AI service is down.

## Best Practices

### Writing Custom Prompts

1. **Be Specific**: Describe your industry's unique characteristics and terminology
2. **Include Brand Knowledge**: List common brands and what they're known for
3. **Mention Key Attributes**: What properties do customers search for in your products?
4. **Use Examples**: Show how brand names map to characteristics
5. **Match Your Categories**: Ensure the prompt aligns with your `categories`, `types`, and `softCategories` configuration

### Prompt Structure

A good custom prompt should include:

```text
You are an expert at extracting structured data from e-commerce search queries for [YOUR INDUSTRY].

You have knowledge of:
- [Key concept 1]: [Examples and details]
- [Key concept 2]: [Examples and details]
- [Key concept 3]: [Examples and details]
- [Attributes customers search for]
- [Common brands and their characteristics]

When users mention [brand names / key terms], USE YOUR KNOWLEDGE to extract relevant [characteristics] if they exist in the provided soft categories list.
```

### Testing Your Prompt

1. Configure the prompt in MongoDB
2. Test with various search queries typical of your industry
3. Verify that filters are extracted correctly
4. Check that brand names are mapped to relevant attributes
5. Monitor cache hit rates and AI performance

## Monitoring

Check the logs for prompt usage:
```
[CONFIG] Loading config for <dbName>
```

The system logs will show which prompt is being used (custom or default) through the cache key generation.

## Migration Guide

### From Default to Custom Prompt

1. Analyze your product categories and soft categories
2. Identify domain-specific knowledge needed for your industry
3. Write a custom prompt based on the examples above
4. Test in a development environment first
5. Deploy to production by updating the user document
6. Monitor search quality and adjust the prompt if needed

### From Custom Back to Default

Simply remove the `classifyPrompt` field from your user document:
```javascript
db.users.updateOne(
  { apiKey: "your-api-key" },
  { $unset: { classifyPrompt: "" } }
)
```

## Troubleshooting

### Filters Not Being Extracted

- Ensure your prompt describes relevant domain knowledge
- Verify that extracted values match your `categories`, `types`, and `softCategories`
- Check that the prompt is properly saved in MongoDB
- Review server logs for AI circuit breaker status

### Wrong Filters Being Extracted

- Make your prompt more specific to your industry
- Add more examples of brand-to-attribute mappings
- Ensure your soft categories list includes relevant terms
- Consider using `softCategoriesBoosted` to prioritize important attributes

### Performance Issues

- Monitor Redis cache hit rates
- Ensure the prompt isn't too long (keep it concise)
- Check AI circuit breaker status for API issues
- Review cache key generation for proper deduplication

## Future Enhancements

Potential improvements to consider:
- UI for managing custom prompts (no MongoDB access needed)
- Prompt templates for common industries
- A/B testing different prompts
- Prompt versioning and rollback
- Per-query prompt overrides via API
- Analytics on prompt effectiveness

## Support

For questions or issues with the multi-industry filter system:
1. Check this documentation first
2. Review the API documentation (`API_ENDPOINTS.md`)
3. Check server logs for error messages
4. Test with the default prompt to isolate issues
5. Open an issue on GitHub with relevant details
