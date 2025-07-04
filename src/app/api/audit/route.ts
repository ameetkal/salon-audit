import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { INSTAGRAM_SCORING_CRITERIA, ScoringResult } from '@/types/instagram';

interface Recommendation {
  category: string;
  suggestions: string[];
  strengths: string[];
}

interface ErrorResponse {
  error: string;
  details?: unknown;
}

async function analyzeProfileImage(imageBuffer: Buffer) {
  try {
    // Get image metadata
    const metadata = await sharp(imageBuffer).metadata();
    
    // Convert to grayscale for analysis
    const { data, info } = await sharp(imageBuffer)
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Define regions more precisely based on typical Instagram profile layout
    const headerHeight = Math.floor(info.height * 0.15); // Profile picture and name
    const bioHeight = Math.floor(info.height * 0.25); // Bio section
    const highlightsHeight = Math.floor(info.height * 0.1); // Story highlights
    const gridStart = headerHeight + bioHeight + highlightsHeight;

    // Extract regions
    const headerRegion = data.slice(0, headerHeight * info.width);
    const bioRegion = data.slice(headerHeight * info.width, (headerHeight + bioHeight) * info.width);
    const highlightsRegion = data.slice((headerHeight + bioHeight) * info.width, (headerHeight + bioHeight + highlightsHeight) * info.width);
    const gridRegion = data.slice(gridStart * info.width);

    // Calculate brightness statistics for each region
    const getRegionStats = (region: Uint8Array) => {
      const values = Array.from(region);
      const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
      const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
      const stdDev = Math.sqrt(variance);
      return { mean, stdDev };
    };

    const headerStats = getRegionStats(headerRegion);
    const bioStats = getRegionStats(bioRegion);
    const highlightsStats = getRegionStats(highlightsRegion);
    const gridStats = getRegionStats(gridRegion);

    // More sophisticated detection logic
    const hasProfilePicture = headerStats.stdDev > 30; // High variation indicates profile picture
    const hasBio = bioStats.stdDev > 20 && bioStats.mean < 240; // Text creates variation
    const hasHighlights = highlightsStats.stdDev > 15; // Highlights create distinct patterns

    // Check for pinned posts (look for pin icon in first few posts)
    const firstPostRegion = gridRegion.slice(0, info.width * 3); // First 3 rows of the grid
    const hasPinnedPosts = firstPostRegion.some((pixel, i) => {
      // Look for pin icon pattern (small dark spot in top-right corner of first post)
      return pixel < 100 && i < info.width * 0.1;
    });

    // Check for business type indicator
    const hasBusinessType = headerStats.stdDev > 40 && headerStats.mean < 200; // Business accounts often have more complex header

    // Improved post count estimation
    const gridBrightnessVariations = gridRegion.filter((pixel, i) => {
      if (i === 0) return false;
      return Math.abs(pixel - gridRegion[i - 1]) > 40;
    }).length;

    const estimatedPostCount = Math.floor(gridBrightnessVariations / (info.width * 0.1));

    // Theme detection with more precise thresholds
    const gridBrightnessThreshold = 180;
    const isDarkTheme = gridStats.mean < gridBrightnessThreshold;

    return {
      hasProfilePicture,
      hasBio,
      hasHighlights,
      hasPinnedPosts,
      hasBusinessType,
      postCount: Math.min(Math.max(estimatedPostCount, 0), 12),
      gridLayout: isDarkTheme ? 'Dark Theme' : 'Light Theme',
      imageWidth: metadata.width,
      imageHeight: metadata.height,
      confidence: {
        profilePicture: headerStats.stdDev,
        bio: bioStats.stdDev,
        highlights: highlightsStats.stdDev
      }
    };
  } catch (error) {
    console.error('Error analyzing image:', error);
    throw new Error('Failed to analyze the screenshot');
  }
}

async function analyzeInstagramHandle(handle: string) {
  try {
    // TODO: Implement Instagram API integration
    // For now, return a mock analysis
    console.log(`Analyzing Instagram handle: ${handle}`); // Using handle to avoid unused variable warning
    return {
      hasProfilePicture: true,
      hasBio: true,
      hasHighlights: true,
      hasPinnedPosts: false,
      hasBusinessType: true,
      postCount: 12,
      gridLayout: 'Light Theme',
      imageWidth: 1080,
      imageHeight: 1920
    };
  } catch (error) {
    console.error('Error analyzing Instagram handle:', error);
    throw new Error('Failed to analyze the Instagram profile');
  }
}

function calculateScore(analysis: any): ScoringResult {
  const details: ScoringResult['details'] = {};
  let totalPoints = 0;
  let maxPoints = 0;

  // Profile Optimization
  const profileOptimization = {
    score: 0,
    maxScore: INSTAGRAM_SCORING_CRITERIA[0].items.length,
    items: {
      "Profile picture quality and relevance": analysis.hasProfilePicture,
      "Bio completeness and clarity": analysis.hasBio,
      "Story highlights organization": analysis.hasHighlights,
      "Link in bio optimization": analysis.hasBio && analysis.hasProfilePicture // Assuming bio with link
    }
  };
  profileOptimization.score = Object.values(profileOptimization.items).filter(Boolean).length;
  totalPoints += profileOptimization.score;
  maxPoints += profileOptimization.maxScore;
  details["Profile Optimization"] = profileOptimization;

  // Content Strategy
  const contentStrategy = {
    score: 0,
    maxScore: INSTAGRAM_SCORING_CRITERIA[1].items.length,
    items: {
      "Post frequency and consistency": analysis.postCount >= 6,
      "Content variety and quality": analysis.postCount >= 12,
      "Grid layout and aesthetics": analysis.gridLayout !== undefined,
      "Caption quality and engagement": analysis.hasBio // Using bio as a proxy for caption quality
    }
  };
  contentStrategy.score = Object.values(contentStrategy.items).filter(Boolean).length;
  totalPoints += contentStrategy.score;
  maxPoints += contentStrategy.maxScore;
  details["Content Strategy"] = contentStrategy;

  // Engagement
  const engagement = {
    score: 0,
    maxScore: INSTAGRAM_SCORING_CRITERIA[2].items.length,
    items: {
      "Response rate to comments": analysis.hasPinnedPosts, // Using pinned posts as a proxy
      "Story engagement": analysis.hasHighlights,
      "Community interaction": analysis.hasBio, // Using bio as a proxy
      "Hashtag strategy": analysis.hasBio // Using bio as a proxy
    }
  };
  engagement.score = Object.values(engagement.items).filter(Boolean).length;
  totalPoints += engagement.score;
  maxPoints += engagement.maxScore;
  details["Engagement"] = engagement;

  return {
    totalPoints,
    maxPoints,
    percentage: Math.round((totalPoints / maxPoints) * 100),
    details
  };
}

const errorResponse = (error: string, details?: unknown): Response => {
  const response: ErrorResponse = { error };
  if (details) response.details = details;
  return new Response(JSON.stringify(response), {
    status: 400,
    headers: { 'Content-Type': 'application/json' }
  });
};

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const handle = formData.get('handle') as string;
    const screenshot = formData.get('screenshot') as File;

    if (!handle && !screenshot) {
      return NextResponse.json(
        { error: 'Either Instagram handle or screenshot is required' },
        { status: 400 }
      );
    }

    let imageAnalysis;
    if (handle) {
      imageAnalysis = await analyzeInstagramHandle(handle);
    } else if (screenshot) {
      const arrayBuffer = await screenshot.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      imageAnalysis = await analyzeProfileImage(buffer);
    }

    // Type assertion since we know imageAnalysis will be defined here
    // due to the validation check at the start of the function
    const analysis = imageAnalysis as NonNullable<typeof imageAnalysis>;

    // Calculate score based on analysis
    const score = calculateScore(analysis);

    // Generate recommendations based on the analysis
    const recommendations: Recommendation[] = [
      {
        category: 'Profile Optimization',
        suggestions: [],
        strengths: []
      },
      {
        category: 'Content Strategy',
        suggestions: [],
        strengths: []
      },
      {
        category: 'Engagement',
        suggestions: [],
        strengths: []
      }
    ];

    // Add specific recommendations and strengths based on image analysis
    if (analysis.hasProfilePicture) {
      recommendations[0].strengths.push('Great job having a profile picture - this helps build trust with potential clients');
    } else {
      recommendations[0].suggestions.unshift('Add a professional profile picture');
    }

    if (analysis.hasBio) {
      recommendations[0].strengths.push('Your bio is present - this is crucial for communicating your brand');
    } else {
      recommendations[0].suggestions.unshift('Add a compelling bio that describes your salon');
    }

    if (analysis.hasHighlights) {
      recommendations[0].strengths.push('Story highlights are present - excellent for showcasing your best work');
    } else {
      recommendations[0].suggestions.unshift('Create Instagram Story highlights to showcase your best work');
    }

    if (analysis.postCount >= 6) {
      recommendations[1].strengths.push(`You have ${analysis.postCount} posts - good start on building your content library`);
    } else {
      recommendations[1].suggestions.unshift('Start posting more content to build your profile');
    }

    // Add theme-specific feedback
    if (analysis.gridLayout === 'Dark Theme') {
      recommendations[0].strengths.push('Dark theme detected - this can help your content stand out');
    } else {
      recommendations[0].strengths.push('Light theme detected - this can create a clean, professional look');
    }

    // Add base recommendations that apply to all profiles
    if (recommendations[0].suggestions.length === 0) {
      recommendations[0].suggestions.push('Consider adding your business hours to your bio');
      recommendations[0].suggestions.push('Include your location in your bio for better local discovery');
    }

    if (recommendations[1].suggestions.length === 0) {
      recommendations[1].suggestions.push('Mix different types of content (before/after, services, team)');
      recommendations[1].suggestions.push('Use high-quality images that showcase your work');
    }

    if (recommendations[2].suggestions.length === 0) {
      recommendations[2].suggestions.push('Respond to comments within 24 hours');
      recommendations[2].suggestions.push('Engage with other local businesses');
    }

    if (analysis.hasPinnedPosts) {
      recommendations[1].strengths.push('You have pinned posts - great for showcasing your best work to new visitors');
    } else {
      recommendations[1].suggestions.unshift('Pin your best-performing posts to the top of your feed to make a strong first impression');
    }

    return NextResponse.json({
      data: {
        recommendations,
        score,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error processing request:', error);
    return NextResponse.json(
      { error: 'Failed to process the request' },
      { status: 500 }
    );
  }
} 