plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.jaal.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.jaal.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        // Emulator loopback to the dev machine. Editable at runtime in Settings (LAN IP / production).
        buildConfigField("String", "DEFAULT_API_BASE", "\"http://10.0.2.2:8787\"")
    }

    buildFeatures { buildConfig = true }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isReturnDefaultValues = true }
    lint {
        // hi/gu translate the visible core; the rest falls back to English (flagged for native review).
        disable += "MissingTranslation"
    }
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    testImplementation("junit:junit:4.13.2")
    // Real org.json on the JVM (the android.jar copy is a stub in unit tests).
    testImplementation("org.json:json:20240303")
}
