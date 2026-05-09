import { NextResponse } from 'next/server';
import Parser from 'rss-parser';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { db } from '../../../firebase';
import { collection, getDocs, addDoc, query, where } from 'firebase/firestore';

// Prevent Next.js from caching this API route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
  try {
    const parser = new Parser();
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const MAX_ITEMS = 2; // Process 2 per run to stay under Vercel's 10s limit
    const DAILY_LIMIT = 10; // Maximum articles to process per day globally
    let itemsAdded = 0;

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    const articlesRef = collection(db, 'articles');

    // 1. Check how many articles we've already scraped today
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const startOfDayISO = today.toISOString();
    
    const todayQuery = query(articlesRef, where("createdAt", ">=", startOfDayISO));
    const todaySnapshot = await getDocs(todayQuery);
    
    if (todaySnapshot.size >= DAILY_LIMIT) {
      return NextResponse.json({ 
        success: true, 
        message: `Daily limit of ${DAILY_LIMIT} articles reached. Sleeping to preserve Google API quota for your other apps.` 
      });
    }

    const queryTerm = encodeURIComponent('"AI" AND ("jobs" OR "employment" OR "hiring")');
    const feeds = [
      { url: `https://news.google.com/rss/search?q=${queryTerm}&hl=en-US&gl=US&ceid=US:en`, source: "Google News" },
      { url: `https://news.search.yahoo.com/rss?p=${queryTerm}`, source: "Yahoo News" },
      { url: `https://news.google.com/rss/search?q=${queryTerm}+site:reuters.com&hl=en-US&gl=US&ceid=US:en`, source: "Reuters" },
      { url: `https://news.google.com/rss/search?q=${queryTerm}+site:msn.com&hl=en-US&gl=US&ceid=US:en`, source: "MSN" }
    ];

    // Fetch existing articles to prevent duplicates
    const existingSnapshot = await getDocs(articlesRef);
    const existingLinks = new Set();
    const existingTitles = new Set();
    
    existingSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.link) existingLinks.add(data.link.trim());
      if (data.title) existingTitles.add(data.title.trim().toLowerCase());
    });

    const results = [];

    for (const feed of feeds) {
      if (itemsAdded >= MAX_ITEMS) break;
      
      try {
        const parsedFeed = await parser.parseURL(feed.url);
        
        for (const item of parsedFeed.items) {
          // Double check both the per-run limit and the global daily limit!
          if (itemsAdded >= MAX_ITEMS || (todaySnapshot.size + itemsAdded) >= DAILY_LIMIT) break;

          const title = item.title || "No Title";
          const link = item.link || "";
          const pubDate = item.pubDate || new Date().toISOString();
          const cleanTitle = title.trim().toLowerCase();

          if (link && !existingLinks.has(link.trim()) && !existingTitles.has(cleanTitle)) {
            // Fetch article content
            try {
              const response = await fetch(link, { headers: { 'User-Agent': 'Mozilla/5.0' }});
              const html = await response.text();
              const textContent = html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                                      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                                      .replace(/<[^>]+>/g, ' ')
                                      .replace(/\s+/g, ' ')
                                      .substring(0, 5000);

              // Gemini AI Synthesis
              const prompt = `You are an expert news analyst. Based on the following article text, write a comprehensive and insightful summary. Your summary MUST be a complete, well-formed paragraph of exactly 40 to 50 words. Do not stop mid-sentence. If the article text is missing or blocked by a paywall, write a full, logical 40-50 word summary based entirely on the implications of the title: "${title}".\n\nText: ${textContent}`;
              
              const aiResult = await model.generateContent(prompt);
              const summary = aiResult.response.text();

              const articleData = {
                title,
                link,
                source: feed.source,
                date: new Date(pubDate).toISOString(),
                summary: summary.trim(),
                createdAt: new Date().toISOString()
              };

              // Save to Firestore
              await addDoc(articlesRef, articleData);
              existingLinks.add(link.trim());
              existingTitles.add(cleanTitle);
              itemsAdded++;
              results.push(articleData);

              // Small delay to prevent hitting Gemini's burst limits, while staying under Vercel's 10-second limit
              await sleep(2000);

            } catch (err) {
              console.error(`Error processing article ${link}:`, err);
            }
          }
        }
      } catch (err) {
        console.error(`Error fetching feed ${feed.url}:`, err);
      }
    }

    return NextResponse.json({ success: true, newItems: itemsAdded, articles: results });
  } catch (error) {
    console.error("Scraping error:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
