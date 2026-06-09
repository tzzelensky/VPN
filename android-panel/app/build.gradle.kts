plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}

android {
    namespace = "com.vpnadmin.panel"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.vpnadmin.panel"
        minSdk = 24
        targetSdk = 34
        versionCode = 5
        versionName = "1.3.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

}

dependencies {
    // Версии под compileSdk 34 + AGP 8.4.2 (core-ktx 1.15+ требует SDK 35)
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("androidx.activity:activity-ktx:1.8.2")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.coordinatorlayout:coordinatorlayout:1.2.0")
    implementation("com.google.android.material:material:1.11.0")
    implementation("androidx.work:work-runtime-ktx:2.9.0")
    // BoM 34.x; analytics не подключаем — тянет measurement с Kotlin 2.2, push не нужен.
    implementation(platform("com.google.firebase:firebase-bom:34.13.0"))
    implementation("com.google.firebase:firebase-messaging")
}
