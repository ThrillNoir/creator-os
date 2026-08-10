export async function register(){
  if(process.env.NEXT_RUNTIME!=="nodejs")return;
  const {startRedditScheduler}=await import("@/lib/publishing/reddit-scheduler");
  startRedditScheduler();
}
