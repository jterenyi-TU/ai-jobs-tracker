'use client';

import { useEffect, useState, useMemo } from 'react';
import { db } from '../firebase';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';

export default function Home() {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSource, setSelectedSource] = useState('All');

  useEffect(() => {
    const q = query(collection(db, 'articles'), orderBy('createdAt', 'desc'));
    
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const docs = [];
      querySnapshot.forEach((doc) => {
        docs.push({ id: doc.id, ...doc.data() });
      });
      setArticles(docs);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching articles: ", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const sources = useMemo(() => {
    const uniqueSources = new Set(articles.map(a => a.source));
    return ['All', ...Array.from(uniqueSources)];
  }, [articles]);

  const filteredArticles = useMemo(() => {
    return articles.filter(article => {
      const matchesSearch = article.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            article.summary.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesSource = selectedSource === 'All' || article.source === selectedSource;
      return matchesSearch && matchesSource;
    });
  }, [articles, searchTerm, selectedSource]);

  const triggerScrape = async () => {
    alert("Triggering manual scrape... this may take 10 seconds in the background. Please wait for the success message.");
    try {
      const response = await fetch('/api/scrape');
      const data = await response.json();
      
      if (data.success) {
        alert(`Scrape completed! Added ${data.newItems} new articles.\nMessage: ${data.message || 'Success'}`);
      } else {
        alert(`Scrape failed with error: ${data.error}`);
      }
    } catch (e) {
      alert(`Network error during scrape: ${e.message}`);
      console.error(e);
    }
  };

  return (
    <main className="container">
      <header className="header">
        <h1>AI Jobs News Tracker</h1>
        <p>Automated real-time aggregation and Gemini AI synthesis</p>
      </header>

      <aside className="sidebar">
        <h3>Sources</h3>
        <ul className="toc-list">
          {sources.map(source => (
            <li key={source}>
              <button 
                className={selectedSource === source ? 'active' : ''}
                onClick={() => setSelectedSource(source)}
              >
                {source}
              </button>
            </li>
          ))}
        </ul>
        
        <div style={{ marginTop: '2rem' }}>
           <button 
            onClick={triggerScrape}
            style={{ width: '100%', padding: '0.75rem', background: 'rgba(139, 92, 246, 0.2)', border: '1px solid #8b5cf6', color: '#fff', borderRadius: '8px', cursor: 'pointer' }}
          >
            ↻ Run Manual Scrape
          </button>
        </div>
      </aside>

      <section className="main-content">
        <div className="search-container">
          <input 
            type="text" 
            className="search-input" 
            placeholder="Search AI jobs, companies, or keywords..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="loading">Loading AI News...</div>
        ) : filteredArticles.length === 0 ? (
          <div className="loading">No articles found. Try adjusting your search.</div>
        ) : (
          filteredArticles.map(article => (
            <article key={article.id} className="card">
              <div className="card-meta">
                <span className="card-source">{article.source}</span>
                <span>{new Date(article.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
              </div>
              <h2>
                <a href={article.link} target="_blank" rel="noopener noreferrer">
                  {article.title}
                </a>
              </h2>
              <div className="ai-summary">
                {article.summary}
              </div>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
