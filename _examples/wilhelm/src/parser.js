const parser = {};

parser.category = {
    pagination: { name: "currentPage" },
    schema: {
        type: "object",
        properties: {
            pages_max: { type: "number" },
            products: {
                type: "array", // empty array will also be valid
                items: {
                    type: "object",
                    properties: {
                        url: { type: "string" },
                        brand: { type: "string" },
                        title: { type: "string" },
                    },
                    required: ["url", "brand", "title"],
                },
            },
        },
        required: ["pages_max", "products"],
    },
    fn: async ({ url }) => {
        {
            const html = window.html[url];
            let $ = cheerio.load(html);

            const products = [];

            const pages_max = Number($(".pagination-select").first().find(".upper-limit").text().replace(/\D/g, ""));

            const category = $(".brand-breadcrumb-ul").text().replace(/\s+/g, " ").replace(/\//g, ">").trim();

            $(".productQvContainer").each((_, n) => {
                const r = {};

                r.pid = $(n).find("#qvButton").attr("data-skuidrr");
                if (!r.pid) return;

                r.url = "https://www.ulta.com" + $(n).find(".prod-desc a").attr("href");

                r.brand = $(n).find(".prod-title").text().trim() || null;

                r.title = $(n).find(".prod-desc").text().trim() || null;

                let price_text = $(n).find(".regPrice").text().trim();

                if (price_text.includes("-")) {
                    r.price = Number(price_text?.split("-").shift().replace(/\D/g, "")) / 100 || null;
                    r.price_max = Number(price_text?.split("-").pop().replace(/\D/g, "")) / 100 || null;
                } else {
                    r.price = Number(price_text?.replace(/\D/g, "")) / 100 || null;
                }

                if ($(n).find(".pro-old-price").text().trim()) {
                    r.price_rrp = Number($(n).find(".pro-old-price").text()?.replace(/\D/g, "")) / 100 || null;
                }

                r.reviews = Number($(n).find(".prodCellReview").text()?.replace(/\D/g, "")) || null;
                r.rating = Number($(n).find(".stars-active").first().attr("id")?.split("_").pop()) || null;

                products.push(r);
            });

            return { category, pages_max, products };
        }
    },
};

parser.product = {
    schema: {
        type: "object",
        properties: {
            title: { type: "string" },
            brand: { type: "string" },
            price: { type: ["number", "null"] },
        },
        required: ["title", "brand"],
    },
    fn: async ({ url }) => {
        const r = {};

        const html = window.html[url];
        let $ = cheerio.load(html);

        const obj = eval($("#js_reduxstore").html());

        const pd = obj.productPage.productDetails;

        r.brand = pd.brand.brandName;
        r.title = pd.product.displayName;
        r.parent_pid = pd.product.id;
        r.reviews = pd.reviewSummary?.reviewCount || null;
        r.rating = pd.reviewSummary?.rating || null;

        r.category = pd.product.categoryPath.items.map((c) => c.name).join(" > ");

        r.pid = pd.sku.id;
        r.variant_type = pd.sku.variant?.variantType || null;
        r.variant_desc = pd.sku.variant?.variantDesc || null;

        r.upc = pd.sku.UPC;

        r.price_rrp = pd.sku.price.listPrice.amount;

        r.price = pd.sku.price?.salePrice?.amount || null;

        if (!r.price) r.price = r.price_rrp;

        r.directions = pd.sku.directions;

        r.ingredients = pd.sku.ingredients;

        r.description = pd.sku.description;

        r.description_long = pd.sku.longDescription;

        r.uom = pd.sku.UOM;

        r.size = pd.sku?.size ? Number(pd.sku.size) : null;

        r.images = [pd.sku.images.mainImage];

        r.images = [...r.images, ...(pd.product.altImages?.items.map((c) => c.mainImage) || [])];

        if (pd?.swatches?.items) {
            r.variants = pd.swatches.items.map((s) => {
                const r = {};
                r.pid = s.skuId;
                r.title = s.altImageText;
                r.images = [s.skuImages.mainImage];
                return r;
            });

            for (const v of r.variants) {
                const fetched = await fetch(`https://www.ulta.com/services/v5/catalog/sku/${v.pid}`);
                const res = await fetched.json();
                v.price = res.data.sku.price.listPrice.amount;
                v.price_rrp = res.data.sku.price?.salePrice?.amount;
                v.variant_type = res.data.sku.variant.variantType;
                v.variant_desc = res.data.sku.variant.variantDesc;
                if (!v.price_rrp) v.price_rrp = v.price;
            }
        }

        return r;
    },
};

module.exports = parser;
