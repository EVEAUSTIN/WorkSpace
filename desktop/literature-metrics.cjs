'use strict';
const {extractMetric}=require('../assets/literature-core.js');
const SOURCES={
  '0169-2046':'https://www.sciencedirect.com/journal/landscape-and-urban-planning/about/insights',
  '2210-6707':'https://www.sciencedirect.com/journal/sustainable-cities-and-society/about/insights',
  '1618-8667':'https://www.sciencedirect.com/journal/urban-forestry-and-urban-greening/about/insights',
  '2398-9629':'https://www.nature.com/natsustain/journal-impact',
  '1758-6798':'https://www.nature.com/natclim/journal-impact',
  '0959-3780':'https://www.sciencedirect.com/journal/global-environmental-change/about/insights',
  '1748-9326':'https://iopscience.iop.org/journal/1748-9326',
  '0160-4120':'https://www.sciencedirect.com/journal/environment-international/about/insights'
};
async function fetchJournalMetric(issn,fetcher=fetch){
  const source=SOURCES[issn];if(!source)throw Error('Unknown journal');
  // Fixed publisher URLs only. Refuse redirect chains to unknown hosts or private services.
  const response=await fetcher(source,{signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!response.ok)throw Error('Publisher unavailable');
  const reader=response.body.getReader();let total=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>4000000)throw Error('Publisher response too large');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
  const found=extractMetric(Buffer.concat(chunks).toString('utf8'));if(!found)throw Error('No unambiguous year-tagged impact factor');
  return {issn,...found,source,method:'publisher',checkedAt:Date.now(),partition:''};
}
module.exports={SOURCES,fetchJournalMetric};
